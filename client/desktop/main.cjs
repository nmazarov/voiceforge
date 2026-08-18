const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  desktopCapturer,
  ipcMain,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const APP_ID = "com.voiceforge.desktop";
let mainWindow;
let tray;
let selectedDisplaySource = "";
let logFile = "";
function logEvent(type, details = "") {
  if (!logFile) return;
  try {
    fs.appendFileSync(
      logFile,
      `${new Date().toISOString()} ${type} ${String(details)}\n`,
      "utf8",
    );
  } catch {}
}
function trayImage() {
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAJ0lEQVR42mNgGAXUB8QwMDD8Z2Bg+M/AwPAfiBqG/0DU/4EoGgAA4qQGQvVYqgAAAABJRU5ErkJggg==",
  );
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 660,
    show: false,
    backgroundColor: "#090b12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("render-process-gone", (_event, details) =>
    logEvent("renderer-gone", JSON.stringify(details)),
  );
  mainWindow.webContents.on("did-fail-load", (_event, code, description) =>
    logEvent("load-failed", `${code} ${description}`),
  );
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) e.preventDefault();
  });
  mainWindow.loadFile(path.join(app.getAppPath(), "app", "dist", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}
app.setAppUserModelId(APP_ID);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
if (hasSingleInstanceLock) {
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
app.whenReady().then(async () => {
  logFile = path.join(app.getPath("userData"), "voiceforge.log");
  logEvent("app-ready", app.getVersion());
  session.defaultSession.setPermissionRequestHandler((_w, p, cb) =>
    cb(["media", "display-capture"].includes(p)),
  );
  ipcMain.handle("vf:get-screen-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail.toDataURL(),
      icon: source.appIcon?.toDataURL() || "",
    }));
  });
  ipcMain.handle("vf:select-screen-source", (_event, id) => {
    selectedDisplaySource = String(id || "");
    return Boolean(selectedDisplaySource);
  });
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((item) => item.id === selectedDisplaySource);
      if (!source) return callback({});
      const selection = { video: source };
      if (process.platform === "win32") selection.audio = "loopback";
      callback(selection);
    },
  );
  createWindow();
  tray = new Tray(trayImage());
  tray.setToolTip("VoiceForge");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Открыть VoiceForge",
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: "separator" },
      {
        label: "Выход",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  app.on("activate", () =>
    BrowserWindow.getAllWindows().length === 0
      ? createWindow()
      : mainWindow.show(),
  );
});
app.on("before-quit", () => {
  app.isQuitting = true;
});
app.on("window-all-closed", () => {});
}
