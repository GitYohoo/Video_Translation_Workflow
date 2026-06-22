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

test("release packaging script cleans old output and runs verification gates", async () => {
  const script = await fs.readFile(
    new URL("../scripts/package_release.ps1", import.meta.url),
    "utf8",
  );

  assert.match(script, /Remove-Item[\s\S]+releaseDirectory/);
  assert.match(script, /Get-CimInstance Win32_Process[\s\S]+ExecutablePath[\s\S]+Stop-Process/);
  assert.match(script, /npm\.cmd[\s\S]+run[\s\S]+test:node/);
  assert.match(script, /python[\s\S]+unittest[\s\S]+discover/);
  assert.match(script, /npm\.cmd[\s\S]+run[\s\S]+desktop:dist/);
  assert.match(script, /Get-ChildItem[\s\S]+releaseDirectory/);
  assert.doesNotMatch(script, /[^\x00-\x7F]/);
  assert.equal(
    packageJson.scripts.release,
    "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\package_release.ps1",
  );
});
