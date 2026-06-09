import fs from "node:fs/promises";

export const defaultRuntimeSettings = {
  projectWorkspaceRoot: "D:\\VideoTranslationProjects",
  voxCpmPython: "D:\\models\\indextts2-venv\\Scripts\\python.exe",
  voxCpmTempDirectory: "D:\\Temp\\VoxCPMRuntime",
  whisperxTokenPath: "D:\\models\\huggingface\\token",
};

function cleanString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeRuntimeSettings(value = {}) {
  return {
    projectWorkspaceRoot: cleanString(
      value.projectWorkspaceRoot,
      defaultRuntimeSettings.projectWorkspaceRoot,
    ),
    voxCpmPython: cleanString(value.voxCpmPython, defaultRuntimeSettings.voxCpmPython),
    voxCpmTempDirectory: cleanString(
      value.voxCpmTempDirectory,
      defaultRuntimeSettings.voxCpmTempDirectory,
    ),
    whisperxTokenPath: cleanString(
      value.whisperxTokenPath,
      defaultRuntimeSettings.whisperxTokenPath,
    ),
  };
}

export async function loadRuntimeSettings(settingsPath) {
  try {
    const content = await fs.readFile(settingsPath, "utf8");
    return normalizeRuntimeSettings(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeRuntimeSettings();
    }
    throw new Error(`运行设置读取失败：${error.message}`);
  }
}
