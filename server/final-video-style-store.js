import fs from "node:fs/promises";
import path from "node:path";

export async function loadFinalVideoStyle(stylePath, normalizeStyle, fallbackStyle) {
  if (!stylePath) {
    return fallbackStyle;
  }
  try {
    const content = await fs.readFile(stylePath, "utf8");
    return normalizeStyle(JSON.parse(content));
  } catch {
    return fallbackStyle;
  }
}

export async function saveFinalVideoStyle(stylePath, style) {
  if (!stylePath) {
    return;
  }
  await fs.mkdir(path.dirname(stylePath), { recursive: true });
  await fs.writeFile(stylePath, `${JSON.stringify(style, null, 2)}\n`, "utf8");
}
