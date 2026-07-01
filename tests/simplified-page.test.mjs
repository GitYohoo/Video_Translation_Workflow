import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await fs.readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const serverSource = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
const simplifiedPageSource = source.slice(
  source.indexOf("function SimplifiedVideoPage"),
  source.indexOf("function VideoPage"),
);
const generatePanelSource = simplifiedPageSource.slice(
  simplifiedPageSource.indexOf('selectedPanel === "generateChinese"'),
  simplifiedPageSource.indexOf('selectedPanel === "reviewChinese"'),
);
const reviewChinesePanelSource = simplifiedPageSource.slice(
  simplifiedPageSource.indexOf('selectedPanel === "reviewChinese"'),
  simplifiedPageSource.indexOf("selectedPanel && !"),
);
const productionPageSource = source.slice(
  source.indexOf("function VideoPage"),
  source.indexOf("function App"),
);
const translationPanelSource = productionPageSource.slice(
  productionPageSource.indexOf('visiblePanel === "translation"'),
  productionPageSource.indexOf('visiblePanel === "englishDubbing"'),
);
const dubbingPanelSource = productionPageSource.slice(
  productionPageSource.indexOf('visiblePanel === "englishDubbing"'),
  productionPageSource.indexOf('visiblePanel === "finalVideo"'),
);
const finalVideoPanelSource = productionPageSource.slice(
  productionPageSource.indexOf('visiblePanel === "finalVideo"'),
  productionPageSource.indexOf('visiblePanel === "finalValidation"'),
);
const finalValidationPanelSource = productionPageSource.slice(
  productionPageSource.indexOf('visiblePanel === "finalValidation"'),
);

test("renders the source video and Chinese subtitle editor on the result page", () => {
  assert.match(source, /src=\{`\/api\/videos\/\$\{record\.id\}\/content`\}/);
  assert.match(source, /workflow\/chinese-subtitle-editor/);
  assert.match(source, /aria-label="最终中文字幕编辑器"/);
  assert.match(source, /保存中文字幕/);
  assert.match(source, /aria-label=\{`第 \$\{cue\.number\} 条说话人`\}/);
  assert.match(source, /editorCues\.map\(\(\{ number, start, end, speaker, text \}\)/);
});

test("lets final Chinese subtitle speakers be applied to matching original speakers", () => {
  assert.match(reviewChinesePanelSource, /applySpeakerToMatchingCues/);
  assert.match(reviewChinesePanelSource, /应用到同角色/);
  assert.match(reviewChinesePanelSource, /role-apply-button/);
  assert.match(source, /const \[editorOriginalCues, setEditorOriginalCues\] = useState\(\[\]\)/);
  assert.match(source, /original\?\.speaker === sourceCue\.speaker/);
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
  assert.match(
    simplifiedPageSource,
    /<VideoPage[\s\S]+videos=\{videos\}[\s\S]+isLoading=\{isLoading\}[\s\S]+embedded[\s\S]+visiblePanel=\{selectedPanel\}/,
  );
  assert.match(source, /aria-label=\{embedded \? "完整制作流程" : undefined\}/);
  assert.match(source, /workflow-step-englishDubbing/);
  assert.match(source, /workflow-step-finalVideo/);
  assert.match(source, /workflow-step-finalValidation/);
});

test("keeps the progress overview and expands only the selected simplified panel", () => {
  assert.match(simplifiedPageSource, /buildSimplifiedWorkflowOverview/);
  assert.match(simplifiedPageSource, /const \[selectedPanel, setSelectedPanel\] = useState\("generateChinese"\)/);
  assert.match(simplifiedPageSource, /setSelectedPanel\("generateChinese"\)/);
  assert.match(simplifiedPageSource, /<ProjectWorkflowOverview/);
  assert.match(simplifiedPageSource, /onStepSelect=\{selectPanel\}/);
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
  assert.match(simplifiedPageSource, /workflow\/final-validation/);
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

test("keeps only the requested translation artifacts on the compact translation page", () => {
  assert.match(translationPanelSource, /label="Gemini 翻译 JSON"/);
  assert.match(translationPanelSource, /label="英文显示字幕 SRT"/);
  assert.doesNotMatch(translationPanelSource, /Gemini 输入：最终中文字幕 SRT/);
  assert.doesNotMatch(translationPanelSource, /Gemini 输出：翻译与整句分段 JSON/);
  assert.doesNotMatch(translationPanelSource, /subtitle-editor-skip-hint/);
});

test("allows editing subtitle time, Chinese text, and English text in the translation table", () => {
  assert.match(translationPanelSource, /aria-label=\{`第 \$\{cue\.number\} 条开始时间`\}/);
  assert.match(translationPanelSource, /updateSubtitleCue\(cue\.number, "start", event\.target\.value\)/);
  assert.match(translationPanelSource, /aria-label=\{`第 \$\{cue\.number\} 条中文字幕`\}/);
  assert.match(translationPanelSource, /updateSubtitleCue\(cue\.number, "chinese", event\.target\.value\)/);
  assert.match(translationPanelSource, /aria-label=\{`第 \$\{cue\.number\} 条英文字幕`\}/);
  assert.match(translationPanelSource, /updateSubtitleCue\(cue\.number, "english", event\.target\.value\)/);
  assert.match(source, /map\(\(\{ number, start, end, role, chinese, english, skipped \}\)/);
});

test("shows insert subtitle controls in both Chinese and bilingual editors", () => {
  assert.match(reviewChinesePanelSource, /insertChineseCueAfter/);
  assert.match(reviewChinesePanelSource, /className="subtitle-insert-button"/);
  assert.match(reviewChinesePanelSource, /aria-label=\{`在第 \$\{cue\.number\} 条中文字幕后新增字幕`\}/);
  assert.match(translationPanelSource, /insertSubtitleCueAfter/);
  assert.match(translationPanelSource, /className="subtitle-insert-button"/);
  assert.match(translationPanelSource, /aria-label=\{`在第 \$\{cue\.number\} 条双语字幕后新增字幕`\}/);
  assert.match(styles, /\.subtitle-insert-row/);
  assert.match(styles, /\.subtitle-insert-button/);
});

test("removes non-actionable translation and final-video ready hints", () => {
  assert.doesNotMatch(translationPanelSource, /可以翻译与校对/);
  assert.doesNotMatch(translationPanelSource, /subtitle-editor-summary/);
  assert.doesNotMatch(finalVideoPanelSource, /finalVideo\?\.status === "ready" && "可以开始"/);
});

test("removes file and directory artifact lists from dubbing and final-video pages", () => {
  assert.doesNotMatch(dubbingPanelSource, /<FileResult/);
  assert.doesNotMatch(dubbingPanelSource, /<DirectoryResult/);
  assert.doesNotMatch(finalVideoPanelSource, /<FileResult/);
  assert.doesNotMatch(finalVideoPanelSource, /<DirectoryResult/);
});

test("moves completed video playback from export into final validation", () => {
  assert.doesNotMatch(finalVideoPanelSource, /className="final-video-player"/);
  assert.match(finalValidationPanelSource, /className="final-video-player"/);
  assert.match(
    finalValidationPanelSource,
    /workflow\/final-validation\/content/,
  );
  assert.match(serverSource, /app\.get\("\/api\/videos\/:id\/workflow\/final-video\/content"/);
});

test("removes single-item redubbing and adds two final validation range actions", () => {
  assert.doesNotMatch(source, /单条重新配音/);
  assert.doesNotMatch(source, /english-dubbing-mix\/redub/);
  assert.match(finalValidationPanelSource, /使用原视频音频/);
  assert.match(finalValidationPanelSource, /清除 MX\+FX 背景底轨/);
  assert.match(finalValidationPanelSource, /设为开始/);
  assert.match(finalValidationPanelSource, /设为结束/);
});

test("adds per-segment dubbing audition, detail editing, and regenerate actions to step four", () => {
  assert.match(dubbingPanelSource, /<DubbingSegmentEditorPanel/);
  assert.match(source, /配音条目/);
  assert.match(source, /配音详情/);
  assert.match(source, /参考音频/);
  assert.match(source, /重新配音该条并合成整轨/);
  assert.match(
    source,
    /workflow\/english-dubbing-mix\/segments\/\$\{selectedDubbingSegmentNumber\}\/regenerate/,
  );
  assert.match(
    serverSource,
    /app\.put\("\/api\/videos\/:id\/workflow\/english-dubbing-mix\/segments\/:segmentNumber\/regenerate"/,
  );
  assert.match(
    serverSource,
    /app\.get\("\/api\/videos\/:id\/workflow\/english-dubbing-mix\/segments\/:segmentNumber\/audio"/,
  );
});

test("uses subtle speaker tones and file picker for dubbing reference audio", () => {
  assert.match(source, /speakerToneClass/);
  assert.match(source, /更改参考音频/);
  assert.match(dubbingPanelSource, /onChooseReferenceAudio/);
  assert.doesNotMatch(source, /value=\{draft\.referenceAudioPath\}/);
  assert.match(source, /reference-audio\/select/);
  assert.match(serverSource, /selectAudioPath/);
  assert.match(styles, /speaker-tone-0/);
});

test("persists subtitle style drafts and restores final validation playback time", () => {
  assert.match(source, /persistFinalVideoStyle/);
  assert.match(source, /workflow\/final-video\/style/);
  assert.match(serverSource, /styleConfigPath/);
  assert.match(serverSource, /loadFinalVideoStyle/);
  assert.match(source, /validationResumeTimeRef/);
  assert.match(finalValidationPanelSource, /onLoadedMetadata/);
});

test("aligns embedded production panels with the project overview edges", () => {
  assert.match(
    styles,
    /\.simplified-detail-page\s*>\s*\.embedded-production-flow\s*\{[^}]*padding:\s*0;[^}]*width:\s*100%;/s,
  );
});

test("keeps only the desktop project list and top-level content pane independently scrollable", () => {
  assert.match(
    styles,
    /\.desktop-mode \.application\s*\{[^}]*height:\s*calc\(100vh - 42px\);[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.desktop-mode \.sidebar\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.desktop-mode \.video-list\s*\{[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.desktop-mode \.application > \.welcome-page,\s*\.desktop-mode \.application > \.detail-page\s*\{[^}]*height:\s*100%;[^}]*overflow-y:\s*auto;/s,
  );
  assert.doesNotMatch(
    styles,
    /\.desktop-mode \.welcome-page,\s*\.desktop-mode \.detail-page\s*\{[^}]*overflow-y:\s*auto;/s,
  );
});

test("lets translation rows and final-video controls follow the top-level content scroll", () => {
  const subtitleTableStyles = styles.slice(
    styles.indexOf(".subtitle-editor-table {"),
    styles.indexOf(".subtitle-editor-header,"),
  );
  assert.doesNotMatch(subtitleTableStyles, /max-height:/);
  assert.doesNotMatch(subtitleTableStyles, /overflow:\s*auto/);
  assert.doesNotMatch(styles, /\.embedded-production-flow\s*\{[^}]*overflow-y:\s*auto;/s);
});
