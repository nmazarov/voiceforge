const { app, BrowserWindow, Menu, Tray, nativeImage, session, desktopCapturer } = require('electron');
const path = require('node:path');

const APP_ID = 'com.voiceforge.desktop';
let mainWindow;
let tray;

function trayImage() {
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAJ0lEQVR42mNgGAXUB8QwMDD8Z2Bg+M/AwPAfiBqG/0DU/4EoGgAA4qQGQvVYqgAAAABJRU5ErkJggg==');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  const indexPath = path.join(app.getAppPath(), 'apps', 'client', 'dist', 'index.html');
  mainWindow.loadFile(indexPath);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

app.setAppUserModelId(APP_ID);
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    callback({ video: sources[0], audio: 'loopback' });
  }, { useSystemPicker: true });

  createWindow();

  tray = new Tray(trayImage());
  tray.setToolTip('VoiceForge');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть VoiceForge', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => {});
