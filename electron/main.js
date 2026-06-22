import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";
import {
  createDefaultDesktopSettings,
  loadDesktopSettings,
  writeDesktopSettings,
} from "./desktop-settings.js";
import { loadDesktopApplication } from "./startup-navigation.js";

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let backendListener = null;
let desktopSettings = null;
let desktopSettingsPath = null;
let quitting = false;

if (!hasSingleInstanceLock) {
  app.quit();
}

async function pathExists(candidatePath) {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function codeRootDirectory() {
  return app.getAppPath();
}

function applicationFilesRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : codeRootDirectory();
}

async function prepareDesktopSettings() {
  const codeRoot = codeRootDirectory();
  const defaults = createDefaultDesktopSettings();

  if (!app.isPackaged) {
    defaults.dataDirectory = path.join(codeRoot, "data");
    defaults.runtimeDirectory = path.join(codeRoot, ".runtime");
  }

  const persistentSettingsPath = path.join(
    createDefaultDesktopSettings().dataDirectory,
    "desktop-settings.json",
  );
  desktopSettingsPath = persistentSettingsPath;
  desktopSettings = await loadDesktopSettings(persistentSettingsPath, defaults);
  await fs.mkdir(desktopSettings.dataDirectory, { recursive: true });
}

function applyBackendEnvironment() {
  process.env.VIDEO_TRANSLATION_APP_ROOT = applicationFilesRoot();
  process.env.VIDEO_TRANSLATION_DATA_DIR = desktopSettings.dataDirectory;
  process.env.VIDEO_TRANSLATION_RUNTIME_DIR = desktopSettings.runtimeDirectory;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f6f8",
    title: "影译工坊",
    icon: path.join(applicationFilesRoot(), "build", "icon.png"),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#1b2533",
      symbolColor: "#e8edf3",
      height: 42,
    },
    webPreferences: {
      preload: path.join(electronDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (backendListener && url.startsWith(backendListener.url)) {
      return;
    }
    event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

}

async function desktopInfo() {
  return {
    isDesktop: true,
    version: app.getVersion(),
    dataDirectory: desktopSettings.dataDirectory,
    runtimeDirectory: desktopSettings.runtimeDirectory,
    dataReady: await pathExists(desktopSettings.dataDirectory),
    runtimeReady: await pathExists(desktopSettings.runtimeDirectory),
    serviceUrl: backendListener?.url || null,
  };
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:get-info", () => desktopInfo());
  ipcMain.handle("desktop:open-directory", async (_event, directoryKind) => {
    const directory = directoryKind === "runtime"
      ? desktopSettings.runtimeDirectory
      : desktopSettings.dataDirectory;
    await fs.mkdir(directory, { recursive: true });
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  });
  ipcMain.handle("desktop:choose-runtime", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择视频处理运行环境目录",
      defaultPath: desktopSettings.runtimeDirectory,
      properties: ["openDirectory"],
      buttonLabel: "使用此目录",
    });
    if (result.canceled || !result.filePaths[0]) {
      return { changed: false };
    }

    desktopSettings = await writeDesktopSettings(desktopSettingsPath, {
      ...desktopSettings,
      runtimeDirectory: result.filePaths[0],
    });
    app.relaunch();
    app.quit();
    return { changed: true };
  });
}

async function startDesktopApplication() {
  await prepareDesktopSettings();
  applyBackendEnvironment();
  nativeTheme.themeSource = "light";
  Menu.setApplicationMenu(null);
  registerDesktopIpc();
  createMainWindow();

  const { startServer } = await import("../server/index.js");
  backendListener = await loadDesktopApplication({
    window: mainWindow,
    splashPath: path.join(electronDirectory, "splash.html"),
    onServerReady: (listener) => {
      backendListener = listener;
    },
    startServer: () => startServer({ port: 0 }),
  });

  const captureArgument = process.argv.find((argument) => argument.startsWith("--capture-preview="));
  if (captureArgument) {
    const capturePath = captureArgument.slice("--capture-preview=".length);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const preview = await mainWindow.webContents.capturePage();
    await fs.mkdir(path.dirname(capturePath), { recursive: true });
    await fs.writeFile(capturePath, preview.toPNG());
    app.quit();
  }
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (!backendListener || quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  backendListener.server.close(() => app.quit());
});

app.whenReady().then(startDesktopApplication).catch(async (error) => {
  console.error(error);
  await dialog.showMessageBox({
    type: "error",
    title: "影译工坊启动失败",
    message: "应用服务未能启动。",
    detail: error?.stack || error?.message || String(error),
  });
  app.quit();
});
