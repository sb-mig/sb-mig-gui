/**
 * Electron Main Process
 *
 * Entry point for the sb-mig GUI application.
 * Handles window creation, IPC communication, and native integrations.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join, basename } from "path";
import { databaseService } from "../services/database.service";
import { sbmigService } from "../services/sbmig.service";
import type { SbmigEnvironment } from "../services/sbmig.service";
import { storyblokService } from "../services/storyblok.service";

// sb-mig api-v2 (CJS-safe via conditional exports)
import {
  createClient,
  stories as apiV2Stories,
  discover as apiV2Discover,
  sync as apiV2Sync,
  precompile as apiV2Precompile,
} from "sb-mig/api-v2";

interface LoadedComponent {
  name: string;
  filePath: string;
  data: unknown;
  error?: string;
}

/**
 * Load component files, precompiling TypeScript using Rollup+SWC (same as sb-mig CLI)
 */
async function loadComponentFiles(
  filePaths: string[],
  workingDir: string
): Promise<LoadedComponent[]> {
  const results: LoadedComponent[] = [];

  // Separate TypeScript and JavaScript files
  const tsFiles = filePaths.filter((f) => f.endsWith(".ts"));
  // Note: JS files are loaded directly via require without precompilation
  const _jsFiles = filePaths.filter((f) => !f.endsWith(".ts"));
  void _jsFiles; // Used for documentation/future use

  // Precompile TypeScript files using sb-mig's Rollup+SWC approach
  const compiledTsFiles: Map<string, string> = new Map();
  if (tsFiles.length > 0) {
    console.log(
      `[loadComponentFiles] Precompiling ${tsFiles.length} TypeScript files...`
    );
    const precompileResult = await apiV2Precompile.precompile(tsFiles, {
      cacheDir: ".sb-mig-cache",
      projectDir: workingDir,
      flushCache: true,
    });

    // Map original TS files to their compiled CJS paths
    for (const compiled of precompileResult.compiled) {
      compiledTsFiles.set(compiled.input, compiled.outputCjs);
    }

    // Add precompile errors to results
    for (const err of precompileResult.errors) {
      const name = basename(err.input)
        .replace(/\.sb\.ts$/, "")
        .replace(/\.(datasource|roles)\.ts$/, "") || "unknown";
      results.push({
        name,
        filePath: err.input,
        data: null,
        error: `Precompile failed: ${err.error}`,
      });
    }

    console.log(
      `[loadComponentFiles] Precompiled ${precompileResult.compiled.length} files, ${precompileResult.errors.length} errors`
    );
  }

  // Process all files
  for (const filePath of filePaths) {
    // Skip TS files that failed to compile (already added to results)
    if (filePath.endsWith(".ts") && !compiledTsFiles.has(filePath)) {
      continue;
    }

    const name = basename(filePath)
      .replace(/\.sb\.(js|cjs|mjs|ts)$/, "")
      .replace(/\.(datasource|roles)\.(js|cjs|ts)$/, "")
      .replace(/\.sb\.(datasource|roles)\.(js|cjs|ts)$/, "") || "unknown";

    try {
      // Use compiled path for TS files, original path for JS files
      const moduleToLoad = compiledTsFiles.get(filePath) || filePath;

      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve(moduleToLoad)];

      // Use require for CJS or compiled files
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loadedModule = require(moduleToLoad);
      const data = loadedModule.default || loadedModule;

      results.push({ name, filePath, data });
    } catch (error) {
      results.push({
        name,
        filePath,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "sb-mig GUI",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0a1929",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Set webContents for services that need to send events
  sbmigService.setWebContents(mainWindow.webContents);

  // Load the app
  if (isDev) {
    mainWindow.loadURL("http://localhost:5174");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * App ready handler
 */
app.whenReady().then(async () => {
  // Initialize database
  databaseService.init();

  // Create window
  createWindow();

  // Register IPC handlers
  registerIpcHandlers();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * App quit handlers
 */
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  databaseService.close();
});

/**
 * Register all IPC handlers
 */
function registerIpcHandlers() {
  // ===== Database Handlers =====

  ipcMain.handle("db:getSetting", (_event, key: string) => {
    return databaseService.getSetting(key);
  });

  ipcMain.handle("db:setSetting", (_event, key: string, value: string) => {
    databaseService.setSetting(key, value);
  });

  ipcMain.handle("db:deleteSetting", (_event, key: string) => {
    databaseService.deleteSetting(key);
  });

  // ===== sb-mig Handlers =====

  ipcMain.handle(
    "sbmig:execute",
    async (
      _event,
      command: string,
      args: string[],
      workingDir: string,
      env: SbmigEnvironment
    ) => {
      if (mainWindow) {
        sbmigService.setWebContents(mainWindow.webContents);
      }
      return await sbmigService.executeCommand(command, args, workingDir, env);
    }
  );

  ipcMain.handle(
    "sbmig:validate",
    async (_event, workingDir: string, env: SbmigEnvironment) => {
      return await sbmigService.validate(workingDir, env);
    }
  );

  ipcMain.handle("sbmig:getVersion", async () => {
    return await sbmigService.getVersion();
  });

  ipcMain.handle("sbmig:isInstalled", async () => {
    return await sbmigService.isInstalled();
  });

  ipcMain.handle("sbmig:getDebugInfo", async () => {
    return await sbmigService.getDebugInfo();
  });

  ipcMain.handle("sbmig:isRunning", () => {
    return sbmigService.isRunning();
  });

  ipcMain.handle("sbmig:killProcess", () => {
    return sbmigService.killCurrentProcess();
  });

  ipcMain.handle("sbmig:selectDirectory", async () => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Storyblok Project Directory",
      message: "Choose the directory containing your storyblok.config.js file",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle(
    "sbmig:discoverComponents",
    async (_event, workingDir: string) => {
      return await sbmigService.discoverComponents(workingDir);
    }
  );

  ipcMain.handle(
    "sbmig:discoverDatasources",
    async (_event, workingDir: string) => {
      return await sbmigService.discoverDatasources(workingDir);
    }
  );

  ipcMain.handle("sbmig:discoverRoles", async (_event, workingDir: string) => {
    return await sbmigService.discoverRoles(workingDir);
  });

  // ===== Storyblok Direct API Handlers =====

  ipcMain.handle(
    "storyblok:fetchStories",
    async (_event, spaceId: string, oauthToken: string) => {
      return await storyblokService.fetchStories(spaceId, oauthToken);
    }
  );

  ipcMain.handle(
    "storyblok:fetchStory",
    async (_event, spaceId: string, storyId: number, oauthToken: string) => {
      return await storyblokService.fetchStory(spaceId, storyId, oauthToken);
    }
  );

  ipcMain.handle(
    "storyblok:getStoryBySlug",
    async (_event, spaceId: string, slug: string, oauthToken: string) => {
      return await storyblokService.getStoryBySlug(spaceId, slug, oauthToken);
    }
  );

  ipcMain.handle(
    "storyblok:copyStories",
    async (
      _event,
      sourceSpaceId: string,
      targetSpaceId: string,
      storyIds: number[],
      destinationParentId: number | null,
      oauthToken: string
    ) => {
      return await storyblokService.copyStories(
        sourceSpaceId,
        targetSpaceId,
        storyIds,
        destinationParentId,
        oauthToken,
        (progress) => {
          mainWindow?.webContents.send("storyblok:copyProgress", progress);
        }
      );
    }
  );

  // ==========================================================================
  // API v2 (sb-mig) - Direct library calls (no CLI spawn)
  // ==========================================================================

  ipcMain.handle(
    "apiv2:fetchStories",
    async (_event, spaceId: string, oauthToken: string) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Stories.fetchStories(client);
    }
  );

  ipcMain.handle(
    "apiv2:fetchStory",
    async (_event, spaceId: string, storyId: number, oauthToken: string) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Stories.getStoryById(client, storyId);
    }
  );

  ipcMain.handle(
    "apiv2:getStoryBySlug",
    async (_event, spaceId: string, slug: string, oauthToken: string) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Stories.getStoryBySlug(client, slug);
    }
  );

  ipcMain.handle(
    "apiv2:copyStories",
    async (
      _event,
      sourceSpaceId: string,
      targetSpaceId: string,
      storyIds: number[],
      destinationParentId: number | null,
      oauthToken: string
    ) => {
      const sourceClient = createClient({
        spaceId: sourceSpaceId,
        oauthToken,
      });
      const targetClient = createClient({
        spaceId: targetSpaceId,
        oauthToken,
      });
      return await apiV2Stories.copyStories(
        sourceClient,
        targetClient,
        {
          storyIds,
          destinationParentId,
        },
        (progress) => {
          mainWindow?.webContents.send("apiv2:copyProgress", progress);
        }
      );
    }
  );

  ipcMain.handle(
    "apiv2:discoverComponents",
    async (_event, workingDir: string) => {
      return await apiV2Discover.discoverComponents(workingDir);
    }
  );

  ipcMain.handle(
    "apiv2:discoverDatasources",
    async (_event, workingDir: string) => {
      return await apiV2Discover.discoverDatasources(workingDir);
    }
  );

  ipcMain.handle("apiv2:discoverRoles", async (_event, workingDir: string) => {
    return await apiV2Discover.discoverRoles(workingDir);
  });

  // Combined load + sync handler for components (loads files then syncs)
  ipcMain.handle(
    "apiv2:loadAndSyncComponents",
    async (
      _event,
      filePaths: string[],
      spaceId: string,
      oauthToken: string,
      workingDir: string,
      options?: { presets?: boolean; ssot?: boolean }
    ) => {
      console.log(
        `[apiv2:loadAndSyncComponents] Loading ${filePaths.length} files from ${workingDir}...`
      );
      console.log(
        `[apiv2:loadAndSyncComponents] spaceId: "${spaceId}", oauthToken length: ${
          oauthToken?.length || 0
        }`
      );

      // Step 1: Load file contents (precompiles TypeScript using Rollup+SWC)
      const loaded = await loadComponentFiles(filePaths, workingDir);

      // Step 2: Separate successful loads from failures
      const successfulLoads = loaded.filter((r) => !r.error);
      const loadErrors = loaded
        .filter((r) => r.error)
        .map((r) => ({ name: r.name, message: r.error! }));

      console.log(
        `[apiv2:loadAndSyncComponents] Loaded ${successfulLoads.length} files, ${loadErrors.length} errors`
      );

      if (successfulLoads.length === 0) {
        return {
          created: [],
          updated: [],
          skipped: [],
          errors: loadErrors,
        };
      }

      // Step 3: Extract component data
      const components = successfulLoads.map((r) => r.data);

      // Step 4: Create client and sync with progress reporting
      console.log(
        `[apiv2:loadAndSyncComponents] Creating client with spaceId: "${spaceId}"`
      );
      const client = createClient({ spaceId, oauthToken });
      console.log(
        `[apiv2:loadAndSyncComponents] Client created, client.spaceId: "${client.spaceId}"`
      );

      const syncResult = await apiV2Sync.syncComponents(client, {
        components,
        presets: options?.presets ?? false,
        ssot: options?.ssot ?? false,
        onProgress: (event) => {
          // Send progress events to renderer
          mainWindow?.webContents.send("apiv2:syncProgress", event);
        },
      });

      // Step 5: Combine results
      return {
        ...syncResult,
        errors: [...syncResult.errors, ...loadErrors],
      };
    }
  );

  ipcMain.handle(
    "apiv2:syncRoles",
    async (
      _event,
      spaceId: string,
      oauthToken: string,
      roles: unknown[],
      dryRun?: boolean
    ) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Sync.syncRoles(client, { roles, dryRun });
    }
  );

  ipcMain.handle(
    "apiv2:syncDatasources",
    async (
      _event,
      spaceId: string,
      oauthToken: string,
      datasources: unknown[],
      dryRun?: boolean
    ) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Sync.syncDatasources(client, {
        datasources,
        dryRun,
      });
    }
  );

  ipcMain.handle(
    "apiv2:syncComponents",
    async (
      _event,
      spaceId: string,
      oauthToken: string,
      components: unknown[],
      options?: { presets?: boolean; ssot?: boolean; dryRun?: boolean }
    ) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Sync.syncComponents(client, {
        components,
        presets: options?.presets,
        ssot: options?.ssot,
        dryRun: options?.dryRun,
      });
    }
  );

  ipcMain.handle(
    "apiv2:syncPlugins",
    async (
      _event,
      spaceId: string,
      oauthToken: string,
      plugins: { name: string; body: string }[],
      dryRun?: boolean
    ) => {
      const client = createClient({ spaceId, oauthToken });
      return await apiV2Sync.syncPlugins(client, { plugins, dryRun });
    }
  );
}
