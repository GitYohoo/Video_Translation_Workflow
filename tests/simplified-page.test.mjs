import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await fs.readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("renders the source video and Chinese subtitle editor on the result page", () => {
  assert.match(source, /src=\{`\/api\/videos\/\$\{record\.id\}\/content`\}/);
  assert.match(source, /workflow\/chinese-subtitle-editor/);
  assert.match(source, /aria-label="最终中文字幕编辑器"/);
  assert.match(source, /保存中文字幕/);
});

test("requires an explicit user click before starting the automatic workflow", () => {
  assert.match(source, /开始生成中文字幕/);
  assert.match(source, /setWorkflowStarted\(true\)/);
  assert.match(source, /started: workflowStarted/);
});

test("uses automatic workflow decisions instead of manual stage controls", () => {
  assert.match(source, /nextAutomaticActions/);
  assert.match(source, /自动生成最终中文字幕/);
  assert.match(source, /element=\{<SimplifiedVideoPage videos=\{videos\} isLoading=\{isLoading\} \/>\}/);
});

test("describes the simplified two-step workflow on the welcome page", () => {
  assert.match(source, /选择视频后点击开始，系统将自动提取、识别并合并最终中文字幕/);
  assert.match(source, /<strong>点击开始生成<\/strong>/);
  assert.match(source, /<strong>播放与校对<\/strong>/);
});

test("styles the video and subtitle editor as a responsive workbench", () => {
  assert.match(styles, /\.subtitle-workbench/);
  assert.match(styles, /\.review-video/);
  assert.match(styles, /\.chinese-cue-row\.active/);
  assert.match(styles, /@media[^}]+max-width[^}]+[\s\S]+\.chinese-cue-row/);
});
