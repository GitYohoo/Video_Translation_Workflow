import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const controllerSource = await fs.readFile(
  new URL("../src/pages/video-page.jsx", import.meta.url),
  "utf8",
);
const translationPanelSource = await fs.readFile(
  new URL("../src/components/translation-stage-panel.jsx", import.meta.url),
  "utf8",
);
const mainSource = [controllerSource, translationPanelSource].join("\n");
const videoDataSource = await fs.readFile(
  new URL("../src/use-video-data.js", import.meta.url),
  "utf8",
);
const serverSource = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
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
  assert.match(videoDataSource, /useSWR\(requestKey, requestJson/);
  assert.match(videoDataSource, /revalidateOnFocus/);
  assert.match(videoDataSource, /refreshWhenIdle \? IDLE_REFRESH_INTERVAL : 0/);
  assert.doesNotMatch(mainSource, /window\.addEventListener\("focus"/);
  assert.doesNotMatch(mainSource, /setInterval\(/);
});

test("accepts revalidated subtitle data until the local editor becomes dirty", () => {
  assert.match(mainSource, /revision: subtitleEditorRevision/);
  assert.match(mainSource, /revalidateOnMount: true/);
  assert.match(mainSource, /subtitleEditorResource\.isValidating/);
  assert.match(mainSource, /subtitleEditorResource\.error/);
  assert.match(mainSource, /subtitleEditorCues !== subtitleEditorOriginalCues/);
  assert.match(mainSource, /\|\| subtitleEditorDirty/);
  assert.doesNotMatch(mainSource, /subtitleEditorInitializationRef/);
});

test("binds the translation cache revision to the Chinese SRT file", () => {
  assert.match(mainSource, /outputs\.srt\.revision/);
  assert.match(serverSource, /revision: srtReady \? await fileRevision\(paths\.srtPath\) : null/);
  assert.match(serverSource, /revision: await fileRevision\(paths\.srtPath\)/);
});

test("punctuation restoration only declares consumed outputs", () => {
  assert.doesNotMatch(punctuationSource, /--corrections-json/);
  assert.doesNotMatch(punctuationSource, /OCR_标点修复_候选说话人/);
  assert.doesNotMatch(punctuationSource, /OCR_最终_带候选说话人/);
  assert.match(punctuationSource, /OCR_标点修复\.srt/);
  assert.match(punctuationSource, /OCR_标点修复数据\.json/);
});
