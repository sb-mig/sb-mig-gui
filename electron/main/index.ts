/**
 * Electron Main Process
 *
 * Entry point for the sb-mig GUI application.
 * Handles window creation, IPC communication, and native integrations.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { databaseService } from '../services/database.service'
import { sbmigService } from '../services/sbmig.service'
import type { SbmigEnvironment } from '../services/sbmig.service'
import { storyblokService } from '../services/storyblok.service'

// Determine if we're in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'sb-mig GUI',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a1929',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  // Set webContents for services that need to send events
  sbmigService.setWebContents(mainWindow.webContents)

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * App ready handler
 */
app.whenReady().then(() => {
  // Initialize database
  databaseService.init()

  // Create window
  createWindow()

  // Register IPC handlers
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

/**
 * App quit handlers
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  databaseService.close()
})

/**
 * Register all IPC handlers
 */
function registerIpcHandlers() {
  // ===== Database Handlers =====

  ipcMain.handle('db:getSetting', (_event, key: string) => {
    return databaseService.getSetting(key)
  })

  ipcMain.handle('db:setSetting', (_event, key: string, value: string) => {
    databaseService.setSetting(key, value)
  })

  ipcMain.handle('db:deleteSetting', (_event, key: string) => {
    databaseService.deleteSetting(key)
  })

  // ===== sb-mig Handlers =====

  ipcMain.handle(
    'sbmig:execute',
    async (_event, command: string, args: string[], workingDir: string, env: SbmigEnvironment) => {
      if (mainWindow) {
        sbmigService.setWebContents(mainWindow.webContents)
      }
      return await sbmigService.executeCommand(command, args, workingDir, env)
    }
  )

  ipcMain.handle('sbmig:validate', async (_event, workingDir: string, env: SbmigEnvironment) => {
    return await sbmigService.validate(workingDir, env)
  })

  ipcMain.handle('sbmig:getVersion', async () => {
    return await sbmigService.getVersion()
  })

  ipcMain.handle('sbmig:isInstalled', async () => {
    return await sbmigService.isInstalled()
  })

  ipcMain.handle('sbmig:getDebugInfo', async () => {
    return await sbmigService.getDebugInfo()
  })

  ipcMain.handle('sbmig:isRunning', () => {
    return sbmigService.isRunning()
  })

  ipcMain.handle('sbmig:killProcess', () => {
    return sbmigService.killCurrentProcess()
  })

  ipcMain.handle('sbmig:selectDirectory', async () => {
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Storyblok Project Directory',
      message: 'Choose the directory containing your storyblok.config.js file',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('sbmig:discoverComponents', async (_event, workingDir: string) => {
    return await sbmigService.discoverComponents(workingDir)
  })

  ipcMain.handle('sbmig:discoverDatasources', async (_event, workingDir: string) => {
    return await sbmigService.discoverDatasources(workingDir)
  })

  ipcMain.handle('sbmig:discoverRoles', async (_event, workingDir: string) => {
    return await sbmigService.discoverRoles(workingDir)
  })

  // ===== Storyblok Direct API Handlers =====

  ipcMain.handle('storyblok:fetchStories', async (_event, spaceId: string, oauthToken: string) => {
    return await storyblokService.fetchStories(spaceId, oauthToken)
  })

  ipcMain.handle(
    'storyblok:fetchStory',
    async (_event, spaceId: string, storyId: number, oauthToken: string) => {
      return await storyblokService.fetchStory(spaceId, storyId, oauthToken)
    }
  )

  ipcMain.handle(
    'storyblok:getStoryBySlug',
    async (_event, spaceId: string, slug: string, oauthToken: string) => {
      return await storyblokService.getStoryBySlug(spaceId, slug, oauthToken)
    }
  )

  ipcMain.handle(
    'storyblok:copyStories',
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
          mainWindow?.webContents.send('storyblok:copyProgress', progress)
        }
      )
    }
  )
}

