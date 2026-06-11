import assert from "node:assert/strict";
import test from "node:test";
import { patchNsisTargetSource } from "../scripts/patch_electron_builder_portable.mjs";

test("preserves the documented false value for portable unpackDirName", () => {
  const source = `
if (typeof unpackDirName === "string" || !unpackDirName) {
    defines.UNPACK_DIR_NAME = unpackDirName || (0, builder_util_1.generateKsuid)();
}
`;

  const result = patchNsisTargetSource(source);

  assert.equal(result.changed, true);
  assert.match(result.source, /unpackDirName !== false/);
  assert.doesNotMatch(
    result.source,
    /^if \(typeof unpackDirName === "string" \|\| !unpackDirName\)/m,
  );
});

test("does not modify an already patched electron-builder source", () => {
  const source = `
if (unpackDirName !== false && (typeof unpackDirName === "string" || !unpackDirName)) {
    defines.UNPACK_DIR_NAME = unpackDirName || (0, builder_util_1.generateKsuid)();
}
`;

  assert.deepEqual(patchNsisTargetSource(source), {
    source,
    changed: false,
  });
});
