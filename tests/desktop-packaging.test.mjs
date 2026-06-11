import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("portable builds isolate each launch in its own temporary directory", () => {
  assert.equal(packageJson.build.portable.unpackDirName, false);
});

test("desktop packages keep workflow scripts outside the asar archive", () => {
  assert.ok(packageJson.build.asarUnpack.includes("scripts/**/*"));
});
