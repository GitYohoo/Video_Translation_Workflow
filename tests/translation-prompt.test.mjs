import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const promptSource = await fs.readFile(
  new URL("../src/subtitle-editor-utils.js", import.meta.url),
  "utf8",
);

test("asks Gemini to calculate and correct TTS speaking speed", () => {
  assert.match(promptSource, /英文词数\s*÷\s*可用秒数\s*×\s*60\s*=\s*WPM/);
  assert.match(promptSource, /90[–-]190 WPM/);
  assert.match(promptSource, /尽量不超过 180 WPM/);
  assert.match(promptSource, /保留原有语境和意思/);
  assert.match(promptSource, /重新计算 WPM/);
  assert.match(promptSource, /segment_type 为 tts/);
  assert.match(promptSource, /preserve_original.*不参与 WPM/s);
  assert.match(promptSource, /"wpm": 124/);
});
