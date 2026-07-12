import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { GatewayManager } from './gateway'
import { ensureConfig, ensureDataDir, ensureGatewayApiKey } from './config'
import { registerGatewayIpc } from './ipc'

// The optaris-gateway sidecar: spawned on ready, killed on quit.
const gateway = new GatewayManager()

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.getoptaris.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Control-plane IPC: the renderer talks to the gateway and its config only through
  // these handlers. Registered before the window loads so the first renderer call
  // always finds them.
  registerGatewayIpc(gateway)

  // Prepare the gateway's config file and data dir, then start the sidecar. The
  // config must exist before the gateway spawns (it loads it at startup), so we
  // await those two quick fs ops; the gateway start itself is not awaited — failures
  // are logged and the supervisor retries with backoff, without blocking the window.
  ensureConfig()
    .then((configPath) =>
      // ensureGatewayApiKey backfills a key for pre-auth configs so the sidecar always
      // spawns already protected. It reads/writes the config, so run it before start.
      Promise.all([Promise.resolve(configPath), ensureDataDir(), ensureGatewayApiKey()])
    )
    .then(([configPath, dataDir]) => gateway.start({ configPath, dataDir }))
    .catch((err) => {
      console.error('[gateway] failed to start:', err)
    })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Kill the gateway sidecar before the app exits so it never outlives us.
app.on('before-quit', () => {
  gateway.stop()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
