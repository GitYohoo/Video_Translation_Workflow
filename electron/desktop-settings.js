import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_ROOT = "D:\\VideoTranslationWorkflow";

export function createDefaultDesktopSettings({ storageRoot = DEFAULT_STORAGE_ROOT } = {}) {
  return {
    schemaVersion: 1,
    dataDirectory: path.win32.join(storageRoot, "data"),
    runtimeDirectory: path.win32.join(storageRoot, "runtime"),
  };
}

function normalizedDirectory(value, fallback) {
  if (typeof value !== "string" || !value.trim() || !path.win32.isAbsolute(value.trim())) {
    return fallback;
  }
  return path.win32.normalize(value.trim());
}

function normalizeDesktopSettings(value, defaults = createDefaultDesktopSettings()) {
  return {
    schemaVersion: 1,
    dataDirectory: normalizedDirectory(value?.dataDirectory, defaults.dataDirectory),
    runtimeDirectory: normalizedDirectory(value?.runtimeDirectory, defaults.runtimeDirectory),
  };
}

export async function loadDesktopSettings(
  settingsPath,
  defaults = createDefaultDesktopSettings(),
) {
  try {
    const savedSettings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    return normalizeDesktopSettings(savedSettings, defaults);
  } catch {
    return defaults;
  }
}

export async function writeDesktopSettings(settingsPath, settings) {
  const normalizedSettings = normalizeDesktopSettings(settings);
  const temporaryPath = `${settingsPath}.tmp`;
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(normalizedSettings, null, 2), "utf8");
  await fs.rename(temporaryPath, settingsPath);
  return normalizedSettings;
}
