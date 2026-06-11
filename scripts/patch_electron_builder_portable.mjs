import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const originalCondition = 'if (typeof unpackDirName === "string" || !unpackDirName) {';
const patchedCondition = 'if (unpackDirName !== false && (typeof unpackDirName === "string" || !unpackDirName)) {';

export function patchNsisTargetSource(source) {
  if (source.includes(patchedCondition)) {
    return { source, changed: false };
  }
  if (!source.includes(originalCondition)) {
    throw new Error(
      "Unsupported app-builder-lib source: portable unpackDirName condition was not found.",
    );
  }
  return {
    source: source.replace(originalCondition, patchedCondition),
    changed: true,
  };
}

async function patchInstalledElectronBuilder() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targetPath = path.join(
    projectRoot,
    "node_modules",
    "app-builder-lib",
    "out",
    "targets",
    "nsis",
    "NsisTarget.js",
  );
  const source = await fs.readFile(targetPath, "utf8");
  const result = patchNsisTargetSource(source);
  if (result.changed) {
    await fs.writeFile(targetPath, result.source, "utf8");
    console.log("Patched electron-builder portable unpack directory behavior.");
  } else {
    console.log("electron-builder portable unpack directory patch is already applied.");
  }
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  await patchInstalledElectronBuilder();
}
