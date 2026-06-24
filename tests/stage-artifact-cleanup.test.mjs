import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanupStageArtifacts } from "../server/stage-artifact-cleanup.js";

async function write(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "old", "utf8");
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cleanup-"));
  const paths = {
    separation: { outputDirectory: path.join(root, "BS") },
    ocr: { outputDirectory: path.join(root, "OCR") },
    finalSubtitles: {
      outputDirectory: path.join(root, "最终中文字幕"),
      translationTarget: { outputDirectory: path.join(root, "英文翻译字幕") },
      controlledTarget: {
        srtPath: path.join(root, "英文翻译字幕", "受控英文字幕.srt"),
        reportPath: path.join(root, "英文翻译字幕", "英文字幕预检报告.json"),
      },
    },
    dubbing: {
      dubbingGroupsDirectory: path.join(root, "英文翻译字幕", "英文配音整句分段"),
      workDirectory: path.join(root, "英文翻译字幕", "英文配音分段"),
    },
    finalVideo: {
      styleConfigPath: path.join(root, "视频_英文配音_字幕样式配置.json"),
      styledAssPath: path.join(root, "视频_英文配音_英文上方字幕.ass"),
      videoPath: path.join(root, "视频_英文配音_内嵌英文字幕.mp4"),
      reportPath: path.join(root, "英文配音视频成片结果.html"),
      previewPaths: [path.join(root, "字幕样式参考帧", "字幕编辑参考帧.jpg")],
    },
    finalValidation: {
      configPath: path.join(root, "视频_最终验证配置.json"),
      videoPath: path.join(root, "视频_英文配音_最终验证.mp4"),
      reportPath: path.join(root, "视频_最终验证结果.html"),
    },
  };
  const logDirectory = path.join(root, "logs");
  const jobDirectory = path.join(root, "jobs");
  const files = {
    separation: path.join(paths.separation.outputDirectory, "dialogue.wav"),
    ocr: path.join(paths.ocr.outputDirectory, "subtitle.srt"),
    finalSubtitle: path.join(paths.finalSubtitles.outputDirectory, "final.srt"),
    translation: path.join(paths.finalSubtitles.translationTarget.outputDirectory, "translation.json"),
    dubbing: path.join(paths.dubbing.workDirectory, "mix.wav"),
    finalVideoStyle: paths.finalVideo.styleConfigPath,
    finalVideo: paths.finalVideo.videoPath,
    finalValidation: paths.finalValidation.videoPath,
    preview: paths.finalVideo.previewPaths[0],
    dubbingLog: path.join(logDirectory, "video-1_VoxCPM_英文配音混音.log"),
    redubLog: path.join(logDirectory, "video-1_VoxCPM_单条重新配音_012.log"),
    finalLog: path.join(logDirectory, "video-1_最终英文成片.log"),
    validationLog: path.join(logDirectory, "video-1_最终验证.log"),
    dubbingJob: path.join(jobDirectory, "video-1_english-dubbing-mix.json"),
    finalJob: path.join(jobDirectory, "video-1_final-video.json"),
    validationJob: path.join(jobDirectory, "video-1_final-validation.json"),
  };
  await Promise.all(Object.values(files).map(write));
  return { files, jobDirectory, logDirectory, paths };
}

test("translation cleanup preserves Chinese outputs and removes translation plus downstream outputs", async () => {
  const data = await fixture();
  await cleanupStageArtifacts({
    stageId: "translation",
    videoId: "video-1",
    ...data,
  });

  assert.equal(await exists(data.files.separation), true);
  assert.equal(await exists(data.files.ocr), true);
  assert.equal(await exists(data.files.finalSubtitle), true);
  assert.equal(await exists(data.files.translation), false);
  assert.equal(await exists(data.files.dubbing), false);
  assert.equal(await exists(data.files.finalVideoStyle), false);
  assert.equal(await exists(data.files.finalVideo), false);
  assert.equal(await exists(data.files.finalValidation), false);
  assert.equal(await exists(data.files.preview), false);
  assert.equal(await exists(data.files.dubbingLog), false);
  assert.equal(await exists(data.files.redubLog), false);
  assert.equal(await exists(data.files.finalLog), false);
  assert.equal(await exists(data.files.validationLog), false);
  assert.equal(await exists(data.files.dubbingJob), false);
  assert.equal(await exists(data.files.finalJob), false);
  assert.equal(await exists(data.files.validationJob), false);
});

test("each user-facing stage has an explicit cleanup scope", async () => {
  for (const stageId of [
    "all",
    "generateChinese",
    "reviewChinese",
    "translation",
    "englishDubbing",
    "finalVideo",
    "finalValidation",
  ]) {
    const data = await fixture();
    const result = await cleanupStageArtifacts({
      stageId,
      videoId: "video-1",
      ...data,
    });
    assert.equal(result.stageId, stageId);
    assert.ok(result.deletedCount > 0);
  }
});

test("all cleanup removes every generated artifact but keeps the source out of scope", async () => {
  const data = await fixture();
  const result = await cleanupStageArtifacts({
    stageId: "all",
    videoId: "video-1",
    ...data,
  });

  assert.equal(result.stageId, "all");
  assert.ok(result.deletedCount > 0);
  assert.equal(await exists(data.files.separation), false);
  assert.equal(await exists(data.files.ocr), false);
  assert.equal(await exists(data.files.finalSubtitle), false);
  assert.equal(await exists(data.files.translation), false);
  assert.equal(await exists(data.files.dubbing), false);
  assert.equal(await exists(data.files.finalVideoStyle), false);
  assert.equal(await exists(data.files.finalVideo), false);
  assert.equal(await exists(data.files.finalValidation), false);
});

test("the simplified page exposes one delete action for the selected stage", async () => {
  const source = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const simplifiedPage = source.slice(
    source.indexOf("function SimplifiedVideoPage"),
    source.indexOf("function VideoPage"),
  );
  assert.match(simplifiedPage, /删除当前步骤产物/);
  assert.match(simplifiedPage, /workflow\/stages\/\$\{stageId\}/);
  assert.match(simplifiedPage, /window\.confirm/);
});

test("the simplified page exposes a separate delete-all-artifacts action", async () => {
  const source = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const simplifiedPage = source.slice(
    source.indexOf("function SimplifiedVideoPage"),
    source.indexOf("function VideoPage"),
  );
  assert.match(simplifiedPage, /删除全部产物/);
  assert.match(simplifiedPage, /deleteAllArtifacts/);
  assert.match(simplifiedPage, /workflow\/stages\/all/);
});

test("the server exposes stage cleanup and blocks deletion while affected work is running", async () => {
  const source = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(source, /app\.delete\("\/api\/videos\/:id\/workflow\/stages\/:stageId"/);
  assert.match(source, /该步骤或后续步骤仍在运行/);
  assert.match(source, /cleanupStageArtifacts/);
});
