/**
 * Electron Main Process
 *
 * Entry point for the sb-mig GUI application.
 * Handles window creation, IPC communication, and native integrations.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "path";
import { databaseService } from "../services/database.service";
import { sbmigService } from "../services/sbmig.service";
import type { SbmigEnvironment } from "../services/sbmig.service";
import { storyblokService } from "../services/storyblok.service";
import { testDynamicImport } from "../services/sbmig-import-test";

// sb-mig api-v2 (CJS-safe via conditional exports)
import {
  createClient,
  stories as apiV2Stories,
  discover as apiV2Discover,
  sync as apiV2Sync,
} from "sb-mig/api-v2";

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// #region agent log (H1)
fetch("http://127.0.0.1:7245/ingest/2a8fc3d7-292a-4522-9c3c-c62f7e925b33", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sessionId: "debug-session",
    runId: "run1",
    hypothesisId: "H1",
    location: "electron/main/index.ts:module-load",
    message: "Electron main loaded",
    data: {
      isDev,
      typeofRequire: typeof require,
      typeofModule: typeof module,
      platform: process.platform,
      node: process.versions?.node,
      electron: process.versions?.electron,
    },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion agent log (H1)

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

  // Test sb-mig import immediately on startup
  console.log("=".repeat(50));
  console.log("[STARTUP] Testing sb-mig import...");
  const testResult = await testDynamicImport();
  console.log(
    "[STARTUP] Import test result:",
    JSON.stringify(testResult, null, 2)
  );
  console.log("=".repeat(50));

  // #region agent log (H4)
  fetch("http://127.0.0.1:7245/ingest/2a8fc3d7-292a-4522-9c3c-c62f7e925b33", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "debug-session",
      runId: "run1",
      hypothesisId: "H4",
      location: "electron/main/index.ts:after-test",
      message: "Interop test completed",
      data: {
        success: Boolean((testResult as any)?.success),
        method: (testResult as any)?.method,
        requireErrorPresent: Boolean((testResult as any)?.requireError),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log (H4)

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

  ipcMain.handle(
    "apiv2:syncRoles",
    async (
      _event,
      spaceId: string,
      oauthToken: string,
      roles: any[],
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
      datasources: any[],
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
      components: any[],
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

  // ===== Test Handlers =====

  ipcMain.handle("test:sbmigImport", async () => {
    console.log("[main] Testing sb-mig import...");
    const result = await testDynamicImport();
    console.log("[main] Test result:", result);
    return result;
  });
}
