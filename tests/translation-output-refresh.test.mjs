import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const mainSource = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const punctuationSource = await fs.readFile(
  new URL("../scripts/restore_ocr_punctuation.py", import.meta.url),
  "utf8",
);

test("keeps Gemini import available when cached readiness is stale", () => {
  assert.doesNotMatch(
    mainSource,
    /!finalSubtitles\.translationTarget\.jsonReady\s*&&\s*!finalSubtitles\.translationTarget\.srtReady/,
  );
  assert.match(mainSource, /disabled=\{isImportingTranslationSrt\}/);
});

test("refreshes externally generated translation output while idle and on focus", () => {
  assert.match(mainSource, /window\.addEventListener\("focus", refreshFinalSubtitlesStatus\)/);
  assert.match(mainSource, /finalSubtitles\?\.status === "running" \? 1500 : 4000/);
});

test("punctuation restoration only declares consumed outputs", () => {
  assert.doesNotMatch(punctuationSource, /--corrections-json/);
  assert.doesNotMatch(punctuationSource, /OCR_标点修复_候选说话人/);
  assert.doesNotMatch(punctuationSource, /OCR_最终_带候选说话人/);
  assert.match(punctuationSource, /OCR_标点修复\.srt/);
  assert.match(punctuationSource, /OCR_标点修复数据\.json/);
});
