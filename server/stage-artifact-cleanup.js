import fs from "node:fs/promises";
import path from "node:path";
import { jobIdFor } from "./job-store.js";

const stageWorkflows = {
  all: [
    "bs-roformer",
    "ocr-subtitles",
    "whisperx-speakers",
    "final-subtitles",
    "english-dubbing-mix",
    "final-video",
    "final-validation",
  ],
  generateChinese: [
    "bs-roformer",
    "ocr-subtitles",
    "whisperx-speakers",
    "final-subtitles",
    "english-dubbing-mix",
    "final-video",
    "final-validation",
  ],
  reviewChinese: ["final-subtitles", "english-dubbing-mix", "final-video", "final-validation"],
  translation: ["english-dubbing-mix", "final-video", "final-validation"],
  englishDubbing: ["english-dubbing-mix", "final-video", "final-validation"],
  finalVideo: ["final-video", "final-validation"],
  finalValidation: ["final-validation"],
};

export function affectedWorkflowsForStage(stageId) {
  const workflows = stageWorkflows[stageId];
  if (!workflows) {
    throw new Error(`未知主流程步骤：${stageId}`);
  }
  return workflows;
}

async function removePath(targetPath) {
  if (!targetPath) {
    return false;
  }
  const existed = await fs.lstat(targetPath).then(() => true, (error) => {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  });
  if (existed) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
  return existed;
}

async function matchingLogPaths(logDirectory, videoId, workflows) {
  const matchers = [];
  if (workflows.includes("bs-roformer")) {
    matchers.push((name) => name === `${videoId}_BS-RoFormer.log`);
  }
  if (workflows.includes("ocr-subtitles")) {
    matchers.push((name) => name === `${videoId}_OCR_字幕校准.log`);
  }
  if (workflows.includes("whisperx-speakers")) {
    matchers.push((name) => name === `${videoId}_WhisperX_说话人字幕.log`);
  }
  if (workflows.includes("final-subtitles")) {
    matchers.push((name) => name === `${videoId}_最终中文字幕.log`);
  }
  if (workflows.includes("english-dubbing-mix")) {
    matchers.push((name) => name.startsWith(`${videoId}_VoxCPM_`));
  }
  if (workflows.includes("final-video")) {
    matchers.push((name) =>
      name === `${videoId}_最终英文成片.log` ||
      name === `${videoId}_最终成片_字幕参考帧.log`);
  }
  if (workflows.includes("final-validation")) {
    matchers.push((name) => name === `${videoId}_最终验证.log`);
  }
  let entries;
  try {
    entries = await fs.readdir(logDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && matchers.some((matches) => matches(entry.name)))
    .map((entry) => path.join(logDirectory, entry.name));
}

function finalVideoArtifacts(paths) {
  return [
    paths.finalVideo?.styleConfigPath,
    paths.finalVideo?.styledAssPath,
    paths.finalVideo?.videoPath,
    paths.finalVideo?.reportPath,
    ...(paths.finalVideo?.previewPaths || []).map((previewPath) => path.dirname(previewPath)),
  ];
}

function finalValidationArtifacts(paths) {
  return [
    paths.finalValidation?.configPath,
    paths.finalValidation?.videoPath,
    paths.finalValidation?.reportPath,
  ];
}

function outputPathsForStage(stageId, paths) {
  const finalArtifacts = finalVideoArtifacts(paths);
  const validationArtifacts = finalValidationArtifacts(paths);
  if (stageId === "all" || stageId === "generateChinese") {
    return [
      paths.separation?.outputDirectory,
      paths.ocr?.outputDirectory,
      paths.finalSubtitles?.outputDirectory,
      paths.finalSubtitles?.translationTarget?.outputDirectory,
      ...finalArtifacts,
      ...validationArtifacts,
    ];
  }
  if (stageId === "reviewChinese") {
    return [
      paths.finalSubtitles?.outputDirectory,
      paths.finalSubtitles?.translationTarget?.outputDirectory,
      ...finalArtifacts,
      ...validationArtifacts,
    ];
  }
  if (stageId === "translation") {
    return [
      paths.finalSubtitles?.translationTarget?.outputDirectory,
      ...finalArtifacts,
      ...validationArtifacts,
    ];
  }
  if (stageId === "englishDubbing") {
    return [
      paths.finalSubtitles?.controlledTarget?.srtPath,
      paths.finalSubtitles?.controlledTarget?.reportPath,
      paths.dubbing?.dubbingGroupsDirectory,
      paths.dubbing?.workDirectory,
      ...finalArtifacts,
      ...validationArtifacts,
    ];
  }
  if (stageId === "finalVideo") {
    return [...finalArtifacts, ...validationArtifacts];
  }
  if (stageId === "finalValidation") {
    return validationArtifacts;
  }
  throw new Error(`未知主流程步骤：${stageId}`);
}

export async function cleanupStageArtifacts({
  stageId,
  videoId,
  paths,
  logDirectory,
  jobDirectory,
}) {
  const workflows = affectedWorkflowsForStage(stageId);
  const logs = await matchingLogPaths(logDirectory, videoId, workflows);
  const jobs = workflows.map((workflow) =>
    path.join(jobDirectory, `${jobIdFor(videoId, workflow)}.json`));
  const targets = [
    ...outputPathsForStage(stageId, paths),
    ...logs,
    ...jobs,
  ].filter(Boolean);
  const uniqueTargets = [...new Set(targets.map((target) => path.resolve(target)))];
  const results = await Promise.all(uniqueTargets.map(removePath));
  return {
    stageId,
    deletedCount: results.filter(Boolean).length,
  };
}
