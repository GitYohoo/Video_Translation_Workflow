import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { readStyleSource } from "./style-source.mjs";

const entrySource = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const simplifiedPageSource = await fs.readFile(
  new URL("../src/pages/simplified-video-page.jsx", import.meta.url),
  "utf8",
);
const productionPageSource = await fs.readFile(
  new URL("../src/pages/video-page.jsx", import.meta.url),
  "utf8",
);
const videoProjectHeaderSource = await fs.readFile(
  new URL("../src/components/video-project-header.jsx", import.meta.url),
  "utf8",
);
const assetStagesSource = await fs.readFile(
  new URL("../src/components/asset-stages-panel.jsx", import.meta.url),
  "utf8",
);
const translationStageSource = await fs.readFile(
  new URL("../src/components/translation-stage-panel.jsx", import.meta.url),
  "utf8",
);
const englishDubbingStageSource = await fs.readFile(
  new URL("../src/components/english-dubbing-stage-panel.jsx", import.meta.url),
  "utf8",
);
const finalVideoStageSource = await fs.readFile(
  new URL("../src/components/final-video-stage-panel.jsx", import.meta.url),
  "utf8",
);
const finalValidationStageSource = await fs.readFile(
  new URL("../src/components/final-validation-stage-panel.jsx", import.meta.url),
  "utf8",
);
const source = [
  entrySource,
  simplifiedPageSource,
  productionPageSource,
  videoProjectHeaderSource,
  assetStagesSource,
  translationStageSource,
  englishDubbingStageSource,
  finalVideoStageSource,
  finalValidationStageSource,
].join("\n");
const styles = await readStyleSource();
const serverSource = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
const appShellSource = await fs.readFile(
  new URL("../src/components/app-shell.jsx", import.meta.url),
  "utf8",
);
const dubbingEditorSource = await fs.readFile(
  new URL("../src/components/dubbing-segment-editor-panel.jsx", import.meta.url),
  "utf8",
);
const dubbingUtilsSource = await fs.readFile(
  new URL("../src/dubbing-utils.js", import.meta.url),
  "utf8",
);
const generatePanelSource = simplifiedPageSource.slice(
  simplifiedPageSource.indexOf('selectedPanel === "generateChinese"'),
  simplifiedPageSource.indexOf('selectedPanel === "reviewChinese"'),
);
const reviewChinesePanelSource = simplifiedPageSource.slice(
  simplifiedPageSource.indexOf('selectedPanel === "reviewChinese"'),
  simplifiedPageSource.indexOf("selectedPanel && !"),
);
const translationPanelSource = translationStageSource;
const dubbingPanelSource = englishDubbingStageSource;
const finalVideoPanelSource = finalVideoStageSource;
const finalValidationPanelSource = finalValidationStageSource;

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
  assert.match(source, /started: effectiveWorkflowStarted/);
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
  assert.match(simplifiedPageSource, /useWorkflowStatus\(record\?\.id, "subtitle-editor"\)/);
  assert.match(simplifiedPageSource, /useWorkflowStatus\(record\?\.id, "english-dubbing-mix"\)/);
  assert.match(simplifiedPageSource, /useWorkflowStatus\(record\?\.id, "final-video"\)/);
  assert.match(simplifiedPageSource, /useWorkflowStatus\(record\?\.id, "final-validation"\)/);
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

test("describes how to start and continue projects on the welcome page", () => {
  assert.match(appShellSource, /选择视频后点击开始，系统将自动提取、识别并合并最终中文字幕/);
  assert.match(appShellSource, /<h1>从原视频开始制作<\/h1>/);
  assert.match(appShellSource, /\{isAddingVideo \? "正在添加\.\.\." : "选择原视频"\}/);
  assert.match(appShellSource, /<h2 id="recent-projects-title">继续制作<\/h2>/);
});

test("disables source replacement while a project workflow is running", () => {
  assert.match(
    simplifiedPageSource,
    /disabled=\{isReplacingSource \|\| projectWorkflowRunning\}/,
  );
  assert.match(
    videoProjectHeaderSource,
    /disabled=\{isReplacingSource \|\| projectWorkflowRunning\}/,
  );
  assert.match(source, /请先等待当前任务完成或取消任务/);
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

test("allows deleting each final Chinese subtitle while keeping one cue", () => {
  assert.match(reviewChinesePanelSource, /deleteChineseCue/);
  assert.match(reviewChinesePanelSource, /aria-label=\{`删除第 \$\{cue\.number\} 条中文字幕`\}/);
  assert.match(reviewChinesePanelSource, /删除当前字幕/);
  assert.match(reviewChinesePanelSource, /disabled=\{editorCues\.length <= 1\}/);
  assert.match(source, /withRenumberedCues\(current\.filter\(\(cue\) => cue\.number !== number\)\)/);
  assert.match(styles, /\.cue-delete-button/);
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
  assert.match(serverSource, /videoRouter\.get\("\/:id\/workflow\/final-video\/content"/);
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
  assert.match(dubbingEditorSource, /配音条目/);
  assert.match(dubbingEditorSource, /配音详情/);
  assert.match(dubbingEditorSource, /参考音频/);
  assert.match(dubbingEditorSource, /重新配音该条并合成整轨/);
  assert.match(
    source,
    /workflow\/english-dubbing-mix\/segments\/\$\{selectedDubbingSegmentNumber\}\/regenerate/,
  );
  assert.match(
    serverSource,
    /videoRouter\.put\("\/:id\/workflow\/english-dubbing-mix\/segments\/:segmentNumber\/regenerate"/,
  );
  assert.match(
    serverSource,
    /videoRouter\.get\("\/:id\/workflow\/english-dubbing-mix\/segments\/:segmentNumber\/audio"/,
  );
});

test("uses subtle speaker tones and file picker for dubbing reference audio", () => {
  assert.match(dubbingUtilsSource, /speakerToneClass/);
  assert.match(dubbingEditorSource, /更改参考音频/);
  assert.match(dubbingPanelSource, /onChooseReferenceAudio/);
  assert.doesNotMatch(dubbingEditorSource, /value=\{draft\.referenceAudioPath\}/);
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
