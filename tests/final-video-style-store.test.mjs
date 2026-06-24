import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadFinalVideoStyle,
  saveFinalVideoStyle,
} from "../server/final-video-style-store.js";

const fallbackStyle = {
  fontName: "Segoe UI Semibold",
  fontSize: 50,
  textColor: "#FFFFFF",
  backgroundColor: "#101010",
  backgroundOpacity: 1,
  positionX: 50,
  positionY: 84,
};

function normalizeStyle(value = {}) {
  return {
    ...fallbackStyle,
    ...value,
    fontSize: Number(value.fontSize ?? fallbackStyle.fontSize),
  };
}

test("persists and loads final video subtitle style beside project outputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-video-style-"));
  const stylePath = path.join(root, "nested", "字幕样式配置.json");
  const style = {
    ...fallbackStyle,
    fontSize: 44,
    positionX: 51,
    positionY: 73,
  };

  await saveFinalVideoStyle(stylePath, style);
  const loaded = await loadFinalVideoStyle(stylePath, normalizeStyle, fallbackStyle);

  assert.deepEqual(loaded, style);
});

test("falls back when subtitle style config is missing or invalid", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-video-style-"));
  const missingPath = path.join(root, "missing.json");
  const invalidPath = path.join(root, "invalid.json");
  await fs.writeFile(invalidPath, "{", "utf8");

  assert.deepEqual(await loadFinalVideoStyle(missingPath, normalizeStyle, fallbackStyle), fallbackStyle);
  assert.deepEqual(await loadFinalVideoStyle(invalidPath, normalizeStyle, fallbackStyle), fallbackStyle);
});
