import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const setupScript = await fs.readFile(
  new URL("../scripts/setup_subtitle_ocr_runtime.ps1", import.meta.url),
  "utf8",
);
const verificationScript = await fs.readFile(
  new URL("../scripts/verify_desktop_package.ps1", import.meta.url),
  "utf8",
);

test("sets up PP-OCRv6 in a D-drive-oriented GPU runtime", () => {
  assert.match(setupScript, /paddlepaddle-gpu==3\.3\.1/);
  assert.match(setupScript, /paddleocr==3\.7\.0/);
  assert.match(setupScript, /PP-OCRv6_medium_det/);
  assert.match(setupScript, /PP-OCRv6_medium_rec/);
  assert.match(setupScript, /D:\\models/);
  assert.match(setupScript, /D:\\Temp\\SubtitleOCRRuntime/);
});

test("keeps the PP-OCRv6 setup script in desktop packages", () => {
  assert.match(verificationScript, /scripts\\setup_subtitle_ocr_runtime\.ps1/);
});
