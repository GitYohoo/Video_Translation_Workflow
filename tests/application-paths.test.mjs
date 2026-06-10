import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveApplicationPaths } from "../server/application-paths.js";

test("uses the repository layout when desktop overrides are absent", () => {
  const serverDirectory = path.join("D:\\workspace", "server");
  const paths = resolveApplicationPaths({ serverDirectory, environment: {} });

  assert.equal(paths.applicationRoot, "D:\\workspace");
  assert.equal(paths.dataDirectory, "D:\\workspace\\data");
  assert.equal(paths.runtimeDirectory, "D:\\workspace\\.runtime");
  assert.equal(paths.distDirectory, "D:\\workspace\\dist");
  assert.equal(paths.scriptsDirectory, "D:\\workspace\\scripts");
});

test("accepts independent application, data, and runtime locations", () => {
  const paths = resolveApplicationPaths({
    serverDirectory: "C:\\installed-app\\resources\\app\\server",
    environment: {
      VIDEO_TRANSLATION_APP_ROOT: "C:\\installed-app\\resources\\app",
      VIDEO_TRANSLATION_DATA_DIR: "D:\\VideoTranslationWorkflow\\data",
      VIDEO_TRANSLATION_RUNTIME_DIR: "D:\\VideoTranslationWorkflow\\runtime",
    },
  });

  assert.equal(paths.applicationRoot, "C:\\installed-app\\resources\\app");
  assert.equal(paths.dataDirectory, "D:\\VideoTranslationWorkflow\\data");
  assert.equal(paths.runtimeDirectory, "D:\\VideoTranslationWorkflow\\runtime");
  assert.equal(paths.distDirectory, "C:\\installed-app\\resources\\app\\dist");
  assert.equal(paths.scriptsDirectory, "C:\\installed-app\\resources\\app\\scripts");
});
