import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDefaultDesktopSettings,
  loadDesktopSettings,
  writeDesktopSettings,
} from "../electron/desktop-settings.js";

test("keeps desktop data and runtime defaults on the D drive", () => {
  assert.deepEqual(createDefaultDesktopSettings(), {
    schemaVersion: 1,
    dataDirectory: "D:\\VideoTranslationWorkflow\\data",
    runtimeDirectory: "D:\\VideoTranslationWorkflow\\runtime",
  });
});

test("loads valid settings and falls back for unsupported values", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-settings-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const settingsPath = path.join(directory, "desktop-settings.json");
  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      schemaVersion: 99,
      dataDirectory: "D:\\CustomData",
      runtimeDirectory: "D:\\ExistingRuntime",
      ignored: true,
    }),
  );

  assert.deepEqual(await loadDesktopSettings(settingsPath), {
    schemaVersion: 1,
    dataDirectory: "D:\\CustomData",
    runtimeDirectory: "D:\\ExistingRuntime",
  });

  await fs.writeFile(settingsPath, "not-json");
  assert.deepEqual(await loadDesktopSettings(settingsPath), createDefaultDesktopSettings());
});

test("writes desktop settings atomically", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-settings-write-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const settingsPath = path.join(directory, "desktop-settings.json");
  const settings = {
    schemaVersion: 1,
    dataDirectory: "D:\\VideoTranslationWorkflow\\data",
    runtimeDirectory: "D:\\Models\\video-runtime",
  };

  await writeDesktopSettings(settingsPath, settings);

  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, "utf8")), settings);
  await assert.rejects(fs.access(`${settingsPath}.tmp`));
});
