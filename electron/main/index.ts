/**
 * Electron Main Process
 *
 * Entry point for the sb-mig GUI application.
 * Handles window creation, IPC communication, and native integrations.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join, basename } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile, rm } from "fs/promises";
import { databaseService } from "../services/database.service";
import { sbmigService } from "../services/sbmig.service";
import type { SbmigEnvironment } from "../services/sbmig.service";
import { storyblokService } from "../services/storyblok.service";

// Sucrase for TypeScript transpilation (pure JavaScript, no native code)
import { transform as sucraseTransform } from "sucrase";

// sb-mig api-v2 (CJS-safe via conditional exports)
import {
  createClient,
  stories as apiV2Stories,
  discover as apiV2Discover,
  sync as apiV2Sync,
} from "sb-mig/api-v2";

interface LoadedComponent {
  name: string;
  filePath: string;
  data: unknown;
  error?: string;
}

/**
 * Precompile TypeScript files using Sucrase
 * Sucrase is a pure JavaScript transpiler - no native code, no WASM, no child processes
 * Works perfectly in packaged Electron apps
 */
async function precompileWithSucrase(
  tsFiles: string[],
  cacheDir: string,
  onProgress?: (message: string) => void
): Promise<{
  compiled: Map<string, string>;
  errors: { file: string; error: string }[];
}> {
  const compiled = new Map<string, string>();
  const errors: { file: string; error: string }[] = [];

  // Ensure cache directory exists
  await mkdir(cacheDir, { recursive: true });

  // Import fs for reading files
  const { readFile } = await import("fs/promises");

  for (const tsFile of tsFiles) {
    const componentName = basename(tsFile).replace(/\.ts$/, "");
    const outputPath = join(cacheDir, `${componentName}.cjs`);

    onProgress?.(`Compiling ${componentName}...`);
    console.log(
      `[precompileWithSucrase] Compiling: ${tsFile} -> ${outputPath}`
    );

    try {
      // Read the TypeScript source
      const source = await readFile(tsFile, "utf-8");

      // Transform using Sucrase (synchronous, pure JS)
      const result = sucraseTransform(source, {
        transforms: ["typescript"],
        disableESTransforms: true, // Keep ES modules syntax
      });

      // Convert ES modules to CommonJS manually
      let code = result.code;

      // Replace export default with module.exports =
      code = code.replace(/export default /, "module.exports = ");

      // Replace named exports: export const X = ... -> exports.X = ...
      code = code.replace(/export const (\w+)/g, "exports.$1");
      code = code.replace(/export let (\w+)/g, "exports.$1");
      code = code.replace(/export var (\w+)/g, "exports.$1");
      code = code.replace(/export function (\w+)/g, "exports.$1 = function $1");

      // Replace ES imports with require
      // import X from 'y' -> const X = require('y').default || require('y')
      code = code.replace(
        /import (\w+) from ['"]([^'"]+)['"]/g,
        "const $1 = require('$2').default || require('$2')"
      );
      // import { X } from 'y' -> const { X } = require('y')
      code = code.replace(
        /import \{([^}]+)\} from ['"]([^'"]+)['"]/g,
        "const {$1} = require('$2')"
      );
      // import * as X from 'y' -> const X = require('y')
      code = code.replace(
        /import \* as (\w+) from ['"]([^'"]+)['"]/g,
        "const $1 = require('$2')"
      );

      // Write the compiled output
      await writeFile(outputPath, code, "utf-8");

      console.log(
        `[precompileWithSucrase] Successfully compiled: ${componentName}`
      );
      compiled.set(tsFile, outputPath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(
        `[precompileWithSucrase] Failed to compile ${componentName}:`,
        error
      );
      errors.push({ file: tsFile, error: errorMsg });
    }
  }

  return { compiled, errors };
}

/**
 * Load component files, precompiling TypeScript using esbuild-wasm
 * Uses the same cache directory as sb-mig CLI: {project}/.sb-mig-cache/sb-mig/
 */
async function loadComponentFiles(
  filePaths: string[],
  workingDir: string,
  onProgress?: (message: string) => void
): Promise<LoadedComponent[]> {
  const results: LoadedComponent[] = [];
  // Use the same cache location as sb-mig CLI: {project}/.sb-mig-cache/sb-mig/
  const projectCacheDir = join(workingDir, ".sb-mig-cache", "sb-mig");

  console.log(`[loadComponentFiles] Starting with ${filePaths.length} files`);
  console.log(`[loadComponentFiles] Working dir: ${workingDir}`);
  console.log(`[loadComponentFiles] Cache dir: ${projectCacheDir}`);

  // Validate that all file paths exist and are within workingDir
  const validFiles = filePaths.filter((f) => {
    // Ensure the file exists
    if (!existsSync(f)) {
      console.warn(`[loadComponentFiles] File not found: ${f}`);
      return false;
    }
    // Security: ensure file is within the working directory (prevent path traversal)
    const normalizedPath = join(f);
    const normalizedWorkDir = join(workingDir);
    if (!normalizedPath.startsWith(normalizedWorkDir)) {
      console.warn(`[loadComponentFiles] File outside working dir: ${f}`);
      return false;
    }
    return true;
  });

  console.log(`[loadComponentFiles] Valid files: ${validFiles.length}`);

  // Separate TypeScript and JavaScript files
  const tsFiles = validFiles.filter((f) => f.endsWith(".ts"));
  const jsFiles = validFiles.filter((f) => !f.endsWith(".ts"));

  console.log(
    `[loadComponentFiles] TS files: ${tsFiles.length}, JS files: ${jsFiles.length}`
  );

  // Precompile TypeScript files using esbuild (works in both dev and production)
  const compiledTsFiles: Map<string, string> = new Map();
  if (tsFiles.length > 0) {
    onProgress?.(`Compiling ${tsFiles.length} TypeScript files...`);
    console.log(
      `[loadComponentFiles] Compiling ${tsFiles.length} TypeScript files using esbuild...`
    );

    try {
      // Use project's cache directory (same as sb-mig CLI)
      // Clear cache first to ensure fresh compilation
      try {
        await rm(projectCacheDir, { recursive: true, force: true });
      } catch {
        // Ignore if doesn't exist
      }

      const { compiled, errors } = await precompileWithSucrase(
        tsFiles,
        projectCacheDir,
        onProgress
      );

      // Copy compiled files to our map
      for (const [input, output] of compiled) {
        compiledTsFiles.set(input, output);
      }

      // Add errors to results
      for (const err of errors) {
        const name =
          basename(err.file)
            .replace(/\.sb\.ts$/, "")
            .replace(/\.(datasource|roles)\.ts$/, "") || "unknown";
        console.error(
          `[loadComponentFiles] Compile error for ${name}: ${err.error}`
        );
        results.push({
          name,
          filePath: err.file,
          data: null,
          error: `Compile failed: ${err.error}`,
        });
      }

      console.log(
        `[loadComponentFiles] Compiled ${compiled.size} files, ${errors.length} errors`
      );
    } catch (compileError) {
      console.error("[loadComponentFiles] Compilation failed:", compileError);
      onProgress?.(
        `Compilation failed: ${
          compileError instanceof Error ? compileError.message : "Unknown error"
        }`
      );

      // Add all TS files as errors if compilation completely fails
      for (const tsFile of tsFiles) {
        const name =
          basename(tsFile)
            .replace(/\.sb\.ts$/, "")
            .replace(/\.(datasource|roles)\.ts$/, "") || "unknown";
        results.push({
          name,
          filePath: tsFile,
          data: null,
          error: `Compile failed: ${
            compileError instanceof Error
              ? compileError.message
              : String(compileError)
          }`,
        });
      }
    }
  }

  // Process JavaScript files directly
  console.log(`[loadComponentFiles] Loading ${jsFiles.length} JS files...`);
  for (const filePath of jsFiles) {
    const name =
      basename(filePath)
        .replace(/\.sb\.(js|cjs|mjs)$/, "")
        .replace(/\.(datasource|roles)\.(js|cjs)$/, "")
        .replace(/\.sb\.(datasource|roles)\.(js|cjs)$/, "") || "unknown";

    onProgress?.(`Loading ${name}...`);
    console.log(`[loadComponentFiles] Loading JS file: ${filePath}`);

    try {
      // Clear require cache to ensure fresh load
      try {
        delete require.cache[require.resolve(filePath)];
      } catch {
        // File might not be in cache
      }

      // Use require for CJS files
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loadedModule = require(filePath);
      const data = loadedModule.default || loadedModule;

      console.log(`[loadComponentFiles] Loaded ${name} successfully`);
      results.push({ name, filePath, data });
    } catch (error) {
      console.error(`[loadComponentFiles] Failed to load ${name}:`, error);
      results.push({
        name,
        filePath,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Process compiled TypeScript files
  console.log(
    `[loadComponentFiles] Loading ${compiledTsFiles.size} compiled TS files...`
  );
  for (const [originalPath, compiledPath] of compiledTsFiles) {
    const name =
      basename(originalPath)
        .replace(/\.sb\.ts$/, "")
        .replace(/\.(datasource|roles)\.ts$/, "")
        .replace(/\.sb\.(datasource|roles)\.ts$/, "") || "unknown";

    onProgress?.(`Loading ${name}...`);
    console.log(
      `[loadComponentFiles] Loading compiled TS file: ${compiledPath}`
    );

    try {
      // Clear require cache to ensure fresh load
      try {
        delete require.cache[require.resolve(compiledPath)];
      } catch {
        // File might not be in cache
      }

      // Use require for compiled CJS files
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loadedModule = require(compiledPath);
      const data = loadedModule.default || loadedModule;

      console.log(`[loadComponentFiles] Loaded ${name} successfully`);
      results.push({ name, filePath: originalPath, data });
    } catch (error) {
      console.error(`[loadComponentFiles] Failed to load ${name}:`, error);
      results.push({
        name,
        filePath: originalPath,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `[loadComponentFiles] Complete. Loaded ${
      results.filter((r) => !r.error).length
    } successfully, ${results.filter((r) => r.error).length} errors`
  );
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
      try {
        console.log(`[apiv2:discoverComponents] Discovering in: ${workingDir}`);

        // Support both TS and CJS files - esbuild handles TS compilation
        const extensions = [".sb.ts", ".sb.cjs", ".sb.js"];

        // Include external (node_modules) components but stay within project bounds
        // The discover function now has security checks to prevent escaping the project directory
        const components = await apiV2Discover.discoverComponents(workingDir, {
          extensions,
        } as Parameters<typeof apiV2Discover.discoverComponents>[1]);
        console.log(
          `[apiv2:discoverComponents] Found ${components.length} components (${
            components.filter((c) => c.type === "local").length
          } local, ${
            components.filter((c) => c.type === "external").length
          } external)`
        );
        return components;
      } catch (error) {
        console.error("[apiv2:discoverComponents] Error:", error);
        return [];
      }
    }
  );

  ipcMain.handle(
    "apiv2:discoverDatasources",
    async (_event, workingDir: string) => {
      try {
        console.log(
          `[apiv2:discoverDatasources] Discovering in: ${workingDir}`
        );
        const datasources = await apiV2Discover.discoverDatasources(workingDir);
        console.log(`[apiv2:discoverDatasources] Found ${datasources.length}`);
        return datasources;
      } catch (error) {
        console.error("[apiv2:discoverDatasources] Error:", error);
        return [];
      }
    }
  );

  ipcMain.handle("apiv2:discoverRoles", async (_event, workingDir: string) => {
    try {
      console.log(`[apiv2:discoverRoles] Discovering in: ${workingDir}`);
      const roles = await apiV2Discover.discoverRoles(workingDir);
      console.log(`[apiv2:discoverRoles] Found ${roles.length}`);
      return roles;
    } catch (error) {
      console.error("[apiv2:discoverRoles] Error:", error);
      return [];
    }
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
      console.log("=".repeat(60));
      console.log("[apiv2:loadAndSyncComponents] STARTING SYNC");
      console.log("=".repeat(60));
      console.log(`[apiv2:loadAndSyncComponents] Files: ${filePaths.length}`);
      console.log(`[apiv2:loadAndSyncComponents] Working dir: ${workingDir}`);
      console.log(`[apiv2:loadAndSyncComponents] Space ID: "${spaceId}"`);
      console.log(
        `[apiv2:loadAndSyncComponents] OAuth token length: ${
          oauthToken?.length || 0
        }`
      );
      console.log(
        `[apiv2:loadAndSyncComponents] Cache dir: ${join(
          workingDir,
          ".sb-mig-cache",
          "sb-mig"
        )}`
      );
      console.log(`[apiv2:loadAndSyncComponents] File paths:`, filePaths);

      // Send initial progress to show we're working on loading
      console.log("[apiv2:loadAndSyncComponents] Sending start progress...");
      mainWindow?.webContents.send("apiv2:syncProgress", {
        type: "start",
        current: 0,
        total: filePaths.length,
        message: "Loading component files...",
      });

      // Step 1: Load file contents (precompiles TypeScript using Rollup+SWC)
      console.log("[apiv2:loadAndSyncComponents] Starting file loading...");
      const loaded = await loadComponentFiles(
        filePaths,
        workingDir,
        (message) => {
          console.log(`[apiv2:loadAndSyncComponents] Progress: ${message}`);
          // Send loading progress to renderer
          mainWindow?.webContents.send("apiv2:syncProgress", {
            type: "progress",
            current: 0,
            total: filePaths.length,
            name: message,
            action: "creating" as const, // Use "creating" to show activity
          });
        }
      );
      console.log(
        `[apiv2:loadAndSyncComponents] File loading complete. Loaded: ${loaded.length}`
      );

      // Step 2: Separate successful loads from failures
      const successfulLoads = loaded.filter((r) => !r.error);
      const loadErrors = loaded
        .filter((r) => r.error)
        .map((r) => ({ name: r.name, message: r.error! }));

      console.log(
        `[apiv2:loadAndSyncComponents] Loaded ${successfulLoads.length} files, ${loadErrors.length} errors`
      );

      // Report any load errors as progress events
      for (const err of loadErrors) {
        mainWindow?.webContents.send("apiv2:syncProgress", {
          type: "progress",
          current: 0,
          total: filePaths.length,
          name: err.name,
          action: "error" as const,
          message: err.message,
        });
      }

      if (successfulLoads.length === 0) {
        mainWindow?.webContents.send("apiv2:syncProgress", {
          type: "complete",
          total: filePaths.length,
          message: `Loading failed: ${loadErrors.length} errors`,
        });
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

      try {
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
      } catch (syncError) {
        console.error("[apiv2:loadAndSyncComponents] Sync failed:", syncError);
        mainWindow?.webContents.send("apiv2:syncProgress", {
          type: "complete",
          total: components.length,
          message: `Sync failed: ${
            syncError instanceof Error ? syncError.message : String(syncError)
          }`,
        });
        return {
          created: [],
          updated: [],
          skipped: [],
          errors: [
            ...loadErrors,
            {
              name: "sync",
              message:
                syncError instanceof Error
                  ? syncError.message
                  : String(syncError),
            },
          ],
        };
      }
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
