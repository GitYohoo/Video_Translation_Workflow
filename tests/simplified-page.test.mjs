import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await fs.readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const simplifiedPageSource = source.slice(
  source.indexOf("function SimplifiedVideoPage"),
  source.indexOf("function VideoPage"),
);
const generatePanelSource = simplifiedPageSource.slice(
  simplifiedPageSource.indexOf('selectedPanel === "generateChinese"'),
  simplifiedPageSource.indexOf('selectedPanel === "reviewChinese"'),
);

test("renders the source video and Chinese subtitle editor on the result page", () => {
  assert.match(source, /src=\{`\/api\/videos\/\$\{record\.id\}\/content`\}/);
  assert.match(source, /workflow\/chinese-subtitle-editor/);
  assert.match(source, /aria-label="最终中文字幕编辑器"/);
  assert.match(source, /保存中文字幕/);
  assert.match(source, /aria-label=\{`第 \$\{cue\.number\} 条说话人`\}/);
  assert.match(source, /editorCues\.map\(\(\{ number, speaker, text \}\)/);
});

test("requires an explicit user click before starting the automatic workflow", () => {
  assert.match(source, /开始生成中文字幕/);
  assert.match(source, /setWorkflowStarted\(true\)/);
  assert.match(source, /started: workflowStarted/);
});

test("keeps the video detail route on the simplified complete workflow", () => {
  assert.match(source, /nextAutomaticActions/);
  assert.match(source, /自动生成最终中文字幕/);
  assert.match(source, /element=\{<SimplifiedVideoPage videos=\{videos\} isLoading=\{isLoading\} \/>\}/);
  assert.match(simplifiedPageSource, /<VideoPage videos=\{videos\} isLoading=\{isLoading\} embedded visiblePanel=\{selectedPanel\} \/>/);
  assert.match(source, /aria-label=\{embedded \? "完整制作流程" : undefined\}/);
  assert.match(source, /workflow-step-englishDubbing/);
  assert.match(source, /workflow-step-finalVideo/);
});

test("keeps the progress overview and expands only the selected simplified panel", () => {
  assert.match(simplifiedPageSource, /buildSimplifiedWorkflowOverview/);
  assert.match(simplifiedPageSource, /const \[selectedPanel, setSelectedPanel\] = useState\("generateChinese"\)/);
  assert.match(simplifiedPageSource, /setSelectedPanel\("generateChinese"\)/);
  assert.match(simplifiedPageSource, /<ProjectWorkflowOverview/);
  assert.match(simplifiedPageSource, /onStepSelect=\{setSelectedPanel\}/);
  assert.match(simplifiedPageSource, /selectedPanel === "generateChinese"/);
  assert.match(simplifiedPageSource, /selectedPanel === "reviewChinese"/);
  assert.match(simplifiedPageSource, /selectedPanel && !\["generateChinese", "reviewChinese"\]\.includes\(selectedPanel\)/);
});

test("loads downstream production status into the simplified progress overview", () => {
  const overviewInput = simplifiedPageSource.slice(
    simplifiedPageSource.indexOf("const simplifiedOverview = buildSimplifiedWorkflowOverview"),
    simplifiedPageSource.indexOf("const selectedOverviewStep"),
  );
  assert.match(simplifiedPageSource, /workflow\/subtitle-editor/);
  assert.match(simplifiedPageSource, /workflow\/english-dubbing-mix/);
  assert.match(simplifiedPageSource, /workflow\/final-video/);
  assert.match(overviewInput, /subtitleEditorComplete:\s*translationStatus\?\.complete/);
  assert.match(overviewInput, /englishDubbing:\s*downstreamEnglishDubbing/);
  assert.match(overviewInput, /finalVideo:\s*downstreamFinalVideo/);
});

test("uses one compact generation card and allows regenerating the final subtitle file", () => {
  assert.match(generatePanelSource, /className=\{`generation-panel \$\{workflowSummary\.state\}`\}/);
  assert.match(generatePanelSource, /重新生成字幕文件/);
  assert.match(generatePanelSource, /onClick=\{regenerateChineseSubtitles\}/);
  assert.match(simplifiedPageSource, /void runAutomaticAction\("finalSubtitles"\)/);
  assert.doesNotMatch(generatePanelSource, /selected-panel-heading/);
  assert.doesNotMatch(generatePanelSource, /source-input-panel/);
  assert.doesNotMatch(generatePanelSource, /automatic-workflow-status/);
  assert.doesNotMatch(generatePanelSource, /final-srt-panel/);
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
