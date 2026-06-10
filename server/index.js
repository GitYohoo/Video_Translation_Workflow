import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createCatalogStore } from "./catalog-store.js";
import { selectVideoPath } from "./file-dialog.js";
import { createJobStore, jobIdFor } from "./job-store.js";
import {
  createProjectPathResolver,
  projectWorkspaceDirectory,
} from "./project-paths.js";
import { loadRuntimeSettings } from "./runtime-settings.js";
import { activeTaskFromJob, recoverWorkflowTask } from "./workflow-job-state.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, "..");
const dataDirectory = path.join(projectDirectory, "data");
const uploadDirectory = path.join(dataDirectory, "uploads");
const thumbnailDirectory = path.join(dataDirectory, "thumbnails");
const logDirectory = path.join(dataDirectory, "logs");
const jobDirectory = path.join(dataDirectory, "jobs");
const catalogPath = path.join(dataDirectory, "videos.json");
const settingsPath = path.join(dataDirectory, "settings.json");
const distDirectory = path.join(projectDirectory, "dist");
const workflowRootDirectory = projectDirectory;
const runtimeSettings = await loadRuntimeSettings(settingsPath);
const bsRoformerRuntimeDirectory = path.join(workflowRootDirectory, ".runtime");
const bsRoformerCoreScript = path.join(workflowRootDirectory, "scripts", "bs_roformer_refinement.py");
const bsRoformerPython = path.join(
  bsRoformerRuntimeDirectory,
  "bs-roformer-venv",
  "Scripts",
  "python.exe",
);
const bsRoformerTempDirectory = path.join(bsRoformerRuntimeDirectory, "tmp");
const bsRoformerModelDirectory = path.join(bsRoformerRuntimeDirectory, "bs-roformer-models");
const subtitleOcrCoreScript = path.join(workflowRootDirectory, "scripts", "burned_subtitle_ocr.py");
const punctuationCoreScript = path.join(workflowRootDirectory, "scripts", "restore_ocr_punctuation.py");
const subtitleOcrPython = path.join(
  bsRoformerRuntimeDirectory,
  "subtitle-ocr-venv",
  "Scripts",
  "python.exe",
);
const punctuationPython = path.join(
  bsRoformerRuntimeDirectory,
  "whisperx-venv",
  "Scripts",
  "python.exe",
);
const whisperxCoreScript = path.join(workflowRootDirectory, "scripts", "whisperx_speaker_subtitles.py");
const whisperxPython = punctuationPython;
const finalSubtitlesCoreScript = path.join(
  workflowRootDirectory,
  "scripts",
  "merge_final_chinese_subtitles.py",
);
const finalSubtitlesPython = punctuationPython;
const controlledEnglishSubtitlesCoreScript = path.join(
  workflowRootDirectory,
  "scripts",
  "prepare_controlled_english_subtitles.py",
);
const planEnglishDubbingGroupsScript = path.join(
  workflowRootDirectory,
  "scripts",
  "plan_english_dubbing_groups.py",
);
const splitDubbingCoreScript = path.join(workflowRootDirectory, "scripts", "split_dubbing_segments.py");
const voxCpmCoreScript = path.join(workflowRootDirectory, "scripts", "voxcpm_dubbing_workflow.py");
const assembleEnglishTrackScript = path.join(
  workflowRootDirectory,
  "scripts",
  "assemble_english_dub_track.py",
);
const renderEnglishVideoScript = path.join(
  workflowRootDirectory,
  "scripts",
  "render_english_dub_video.py",
);
const voxCpmPython = runtimeSettings.voxCpmPython;
const voxCpmModelId = "openbmb/VoxCPM2";
const voxCpmTempDirectory = runtimeSettings.voxCpmTempDirectory;
const whisperxModelDirectory = path.join(bsRoformerRuntimeDirectory, "whisperx-models");
const whisperxTokenPath = runtimeSettings.whisperxTokenPath;
const ffmpegDirectory = path.join(
  bsRoformerRuntimeDirectory,
  "ffmpeg",
  "ffmpeg-8.1.1-essentials_build",
  "bin",
);
const torchLibraryDirectory = path.join(
  bsRoformerRuntimeDirectory,
  "whisperx-venv",
  "Lib",
  "site-packages",
  "torch",
  "lib",
);
const projectPathResolver = createProjectPathResolver({ uploadDirectory });
const {
  sourceFilePath,
  bsRoformerOutputPaths,
  ocrOutputPaths,
  whisperxOutputPaths,
  finalSubtitlesOutputPaths,
  englishDubbingOutputPaths,
  finalVideoOutputPaths,
  artifactPathForKey,
  knownProjectPaths,
} = projectPathResolver;
const port = Number(process.env.PORT || 3001);
const nonSpeechFallbackPatterns = [
  { pattern: /哈{2,}|呵{2,}|笑声|大笑|冷笑|嗤笑|偷笑|笑|laughs?|laughter|chuckles?|giggles?/i, text: "[laughs]" },
  { pattern: /哭声|哭泣|抽泣|啜泣|呜咽|crying|sobbing/i, text: "[crying]" },
  { pattern: /喘息|喘气|气喘|倒吸|breath(?:ing)?|gasps?/i, text: "[breathing]" },
  { pattern: /尖叫|惊叫|screams?/i, text: "[screams]" },
  { pattern: /咳嗽|咳|coughs?/i, text: "[coughs]" },
  { pattern: /叹气|叹息|sighs?/i, text: "[sighs]" },
];
const videoMimeTypes = new Map([
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".webm", "video/webm"],
  [".m4v", "video/x-m4v"],
  [".wmv", "video/x-ms-wmv"],
  [".flv", "video/x-flv"],
  [".ts", "video/mp2t"],
]);
const editableSubtitleTimePattern =
  /^(?<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(?<end>\d{2}:\d{2}:\d{2}[,.]\d{3})$/;
const editableSubtitleSpeakerPattern = /^\[(?<speaker>[^\]\r\n]+)\]\s*(?<text>[\s\S]*)$/;

await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(uploadDirectory, { recursive: true });
await fs.mkdir(thumbnailDirectory, { recursive: true });
await fs.mkdir(logDirectory, { recursive: true });
await fs.mkdir(jobDirectory, { recursive: true });

const activeThumbnailTasks = new Map();
const activeBsRoformerTasks = new Map();
const activeOcrTasks = new Map();
const activeWhisperxTasks = new Map();
const activeFinalSubtitlesTasks = new Map();
const activeEnglishDubbingTasks = new Map();
const activeFinalVideoTasks = new Map();
const OCR_SUBTITLES_WORKFLOW = "ocr-subtitles";
const WHISPERX_SPEAKERS_WORKFLOW = "whisperx-speakers";
const finalVideoStyles = new Map();
const catalogStore = createCatalogStore(catalogPath);
const { loadCatalog, writeCatalog, findVideoById, sortedVideos } = catalogStore;
const jobStore = createJobStore(jobDirectory);

function publicVideo(record) {
  return {
    id: record.id,
    name: record.name,
    size: record.size,
    type: record.type,
    createdAt: record.createdAt,
    sourcePath: record.sourcePath || null,
    storageMode: record.sourcePath ? "reference" : "legacy-copy",
    contentUrl: `/api/videos/${record.id}/content`,
    thumbnailUrl: `/api/videos/${record.id}/thumbnail`,
  };
}

function finalVideoStyle(value = {}) {
  const fontName =
    typeof value.fontName === "string" && value.fontName.trim()
      ? value.fontName.trim().slice(0, 80)
      : "Segoe UI Semibold";
  const fontSize = Number(value.fontSize ?? 50);
  const bottomMargin = Number(value.bottomMargin ?? 148);
  const backgroundOpacity = Number(value.backgroundOpacity ?? 1);
  const textColor =
    typeof value.textColor === "string" && /^#[0-9a-f]{6}$/i.test(value.textColor)
      ? value.textColor.toUpperCase()
      : "#FFFFFF";
  const backgroundColor =
    typeof value.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(value.backgroundColor)
      ? value.backgroundColor.toUpperCase()
      : "#101010";
  if (!Number.isFinite(fontSize) || fontSize < 18 || fontSize > 96) {
    throw new Error("字幕字号必须在 18 至 96 之间。");
  }
  if (!Number.isFinite(bottomMargin) || bottomMargin < 20 || bottomMargin > 500) {
    throw new Error("字幕下边距必须在 20 至 500 之间。");
  }
  if (!Number.isFinite(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 1) {
    throw new Error("字幕背景不透明度必须在 0 至 1 之间。");
  }
  return { fontName, fontSize, textColor, backgroundColor, backgroundOpacity, bottomMargin };
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directoryPath) {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function modificationTime(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

function parseVoxCpmProgressLogContent(content) {
  const progressPattern =
    /\[(\d+)\/(\d+)\]\s*(合成|已完成|已存在，跳过|时间窗已变化，重新适配|保留原声)第\s+(\d+)\s+段(?:：([^\r\n]+))?/g;
  const completedNumbers = new Set();
  let total = 0;
  let current = 0;
  let currentSegment = null;
  let currentAction = null;
  let currentDetail = "";
  let lastLine = "";
  for (const match of content.matchAll(progressPattern)) {
    current = Number(match[1]);
    total = Math.max(total, Number(match[2]));
    currentAction = match[3];
    currentSegment = Number(match[4]);
    currentDetail = (match[5] || "").trim();
    lastLine = match[0].trim();
    if (currentAction !== "合成") {
      completedNumbers.add(currentSegment);
    }
  }
  const generatedMatch = content.match(/已生成英文配音片段：\s*(\d+)\s*个/);
  const generatedClips = generatedMatch ? Number(generatedMatch[1]) : null;
  if (generatedClips !== null) {
    for (let number = 1; number <= generatedClips; number += 1) {
      completedNumbers.add(number);
    }
    total = Math.max(total, generatedClips);
  }
  const completed = completedNumbers.size;
  const percent = total > 0 ? Math.min(100, Math.round((completed * 1000) / total) / 10) : 0;
  return {
    total,
    completed,
    percent,
    current,
    currentSegment,
    currentAction,
    currentDetail,
    lastLine,
    generatedClips,
    completedSegmentIds: [...completedNumbers]
      .sort((left, right) => left - right)
      .map((number) => String(number).padStart(3, "0")),
    isComplete: total > 0 && completed >= total,
  };
}

async function readVoxCpmProgress(progressLogPath) {
  try {
    const content = await fs.readFile(progressLogPath, "utf8");
    const progress = parseVoxCpmProgressLogContent(content);
    return {
      ...progress,
      logPath: progressLogPath,
      ready: true,
    };
  } catch {
    return {
      total: 0,
      completed: 0,
      percent: 0,
      current: 0,
      currentSegment: null,
      currentAction: null,
      currentDetail: "",
      lastLine: "",
      generatedClips: null,
      completedSegmentIds: [],
      isComplete: false,
      logPath: progressLogPath,
      ready: false,
    };
  }
}

function parseSubtitleMilliseconds(value) {
  const [hours, minutes, secondsPart] = value.replace(".", ",").split(":");
  const [seconds, milliseconds] = secondsPart.split(",");
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function parseEditableSubtitleDocument(content, label) {
  const blocks = content
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean);
  if (blocks.length === 0) {
    throw new Error(`${label}没有字幕条目。`);
  }
  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/);
    const number = Number(lines[0]?.trim());
    if (!Number.isInteger(number) || number <= 0 || lines.length < 3) {
      throw new Error(`${label}第 ${index + 1} 段格式无效。`);
    }
    const timeMatch = editableSubtitleTimePattern.exec(lines[1]?.trim());
    if (!timeMatch) {
      throw new Error(`${label}第 ${number} 段时间格式无效。`);
    }
    const start = timeMatch.groups.start.replace(".", ",");
    const end = timeMatch.groups.end.replace(".", ",");
    const startMs = parseSubtitleMilliseconds(start);
    const endMs = parseSubtitleMilliseconds(end);
    if (endMs <= startMs) {
      throw new Error(`${label}第 ${number} 段结束时间必须晚于开始时间。`);
    }
    const text = lines.slice(2).join("\n").trim();
    if (!text) {
      throw new Error(`${label}第 ${number} 段没有字幕正文。`);
    }
    return { number, start, end, startMs, endMs, text };
  });
}

function parseTranslatedSubtitleTextDocument(content, label) {
  const blocks = content
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean);
  if (blocks.length === 0) {
    throw new Error(`${label}没有字幕条目。`);
  }
  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/);
    const number = Number(lines[0]?.trim());
    if (!Number.isInteger(number) || number <= 0 || lines.length < 3) {
      throw new Error(`${label}第 ${index + 1} 段格式无效。`);
    }
    if (!lines[1]?.includes("-->")) {
      throw new Error(`${label}第 ${number} 段缺少 SRT 时间行。`);
    }
    const text = lines.slice(2).join("\n").trim();
    if (!text) {
      throw new Error(`${label}第 ${number} 段没有字幕正文。`);
    }
    return { number, text };
  });
}

function parseGeminiDisplaySubtitles(content, label) {
  let payload;
  try {
    payload = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${label}不是有效 JSON：${error.message}`);
  }
  if (!payload || !Array.isArray(payload.display_subtitles) || payload.display_subtitles.length === 0) {
    throw new Error(`${label}缺少 display_subtitles 数组。`);
  }
  return payload.display_subtitles.map((item, index) => {
    const number = Number(item?.index ?? index + 1);
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`${label}第 ${index + 1} 条 display_subtitles 编号无效。`);
    }
    const rawText = typeof item?.text === "string" ? item.text.trim() : "";
    const speaker = typeof item?.speaker === "string" ? item.speaker.trim() : "";
    const parsed = subtitleRoleAndText(rawText);
    const text = parsed.text || rawText;
    return {
      number,
      text: text && speaker && !parsed.role ? taggedSubtitleText(speaker, text) : rawText,
    };
  });
}

function subtitleRoleAndText(text) {
  const trimmed = text.trim();
  const match = editableSubtitleSpeakerPattern.exec(trimmed);
  if (!match) {
    return { role: "", text: trimmed };
  }
  const role = match.groups.speaker.trim();
  const body = match.groups.text.trim();
  if (!body && nonSpeechEnglishFallback(role)) {
    return { role: "", text: trimmed };
  }
  return {
    role,
    text: body,
  };
}

function nonSpeechEnglishFallback(chineseText) {
  const normalized = String(chineseText || "").replace(/\s+/g, "");
  for (const { pattern, text } of nonSpeechFallbackPatterns) {
    if (pattern.test(normalized)) {
      return text;
    }
  }
  return "";
}

function validateEditableMasterTimeline(cues) {
  cues.forEach((cue, index) => {
    if (cue.number !== index + 1) {
      throw new Error(`最终中文字幕编号不连续：期望第 ${index + 1} 段。`);
    }
    if (index > 0 && cue.startMs < cues[index - 1].endMs) {
      throw new Error(`最终中文字幕存在时间重叠：第 ${cue.number - 1} 与 ${cue.number} 段。`);
    }
  });
}

function taggedSubtitleText(role, text) {
  return role ? `[${role}] ${text}` : text;
}

function serializeEditableSubtitleDocument(cues) {
  return `\uFEFF${cues
    .map((cue) => `${cue.number}\n${cue.start} --> ${cue.end}\n${cue.text}\n`)
    .join("\n")}`;
}

async function writeFileIfChanged(filePath, content) {
  const existing = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (existing === content) {
    return false;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return true;
}

async function removeFileIfExists(filePath) {
  const existed = await isFile(filePath);
  if (existed) {
    await fs.rm(filePath, { force: true });
  }
  return existed;
}

async function subtitleEditorState(record) {
  const paths = finalSubtitlesOutputPaths(record);
  if (!paths || !(await isFile(paths.srtPath))) {
    return {
      status: "blocked",
      canEdit: false,
      error: "请先生成最终中文字幕。",
      cues: [],
    };
  }
  const canonical = parseEditableSubtitleDocument(
    await fs.readFile(paths.srtPath, "utf8"),
    "最终中文字幕",
  );
  validateEditableMasterTimeline(canonical);
  let englishByNumber = new Map();
  let skippedByNumber = new Map();
  let draftError = null;
  let hasSavedTranslation = false;
  if (await isFile(paths.translationTarget.editorDraftPath)) {
    try {
      const savedDraft = JSON.parse(await fs.readFile(paths.translationTarget.editorDraftPath, "utf8"));
      if (!Array.isArray(savedDraft.cues)) {
        throw new Error("草稿内容缺少字幕列表。");
      }
      hasSavedTranslation = true;
      for (const cue of savedDraft.cues) {
        const number = Number(cue.number);
        if (!Number.isInteger(number) || number <= 0) {
          throw new Error("草稿内容中的字幕编号无效。");
        }
        const english = typeof cue.english === "string" ? cue.english.trim() : "";
        englishByNumber.set(number, english);
        skippedByNumber.set(number, Boolean(cue.skipped) || !english);
      }
    } catch (error) {
      draftError = `无法读取字幕编辑草稿：${error.message}`;
    }
  } else if (await isFile(paths.translationTarget.srtPath)) {
    try {
      hasSavedTranslation = true;
      const englishDraft = parseTranslatedSubtitleTextDocument(
        await fs.readFile(paths.translationTarget.srtPath, "utf8"),
        "英文字幕译稿",
      );
      englishByNumber = new Map(
        englishDraft.map((cue) => [cue.number, subtitleRoleAndText(cue.text).text]),
      );
      skippedByNumber = new Map(englishDraft.map((cue) => [cue.number, false]));
    } catch (error) {
      draftError = error.message;
    }
  }
  const cues = canonical.map((cue) => {
    const canonicalParts = subtitleRoleAndText(cue.text);
    const fallbackEnglish = nonSpeechEnglishFallback(canonicalParts.text);
    const english = englishByNumber.get(cue.number) || fallbackEnglish;
    const skipped = skippedByNumber.has(cue.number)
      ? skippedByNumber.get(cue.number) && !fallbackEnglish
      : hasSavedTranslation && !english;
    return {
      number: cue.number,
      start: cue.start,
      end: cue.end,
      role: canonicalParts.role,
      chinese: canonicalParts.text,
      english,
      skipped,
    };
  });
  return {
    status: "ready",
    canEdit: true,
    draftError,
    completedEnglishCount: cues.filter((cue) => cue.english).length,
    skippedEnglishCount: cues.filter((cue) => cue.skipped).length,
    missingEnglishNumbers: cues.filter((cue) => !cue.english && !cue.skipped).map((cue) => cue.number),
    complete: hasSavedTranslation && cues.every((cue) => cue.english || cue.skipped),
    cues,
  };
}

async function importTranslatedSubtitleFile(record) {
  if (activeEnglishDubbingTasks.get(record.id)?.status === "running") {
    throw new Error("英文配音正在运行，完成后再读取英文字幕译稿。");
  }
  const paths = finalSubtitlesOutputPaths(record);
  if (!paths || !(await isFile(paths.srtPath))) {
    throw new Error("请先生成最终中文字幕。");
  }
  const hasGeminiJson = await isFile(paths.translationTarget.jsonPath);
  const hasLegacySrt = await isFile(paths.translationTarget.srtPath);
  if (!hasGeminiJson && !hasLegacySrt) {
    throw new Error(
      `找不到 Gemini 输出文件：${paths.translationTarget.jsonPath}；也没有旧版 SRT：${paths.translationTarget.srtPath}`,
    );
  }
  const canonical = parseEditableSubtitleDocument(
    await fs.readFile(paths.srtPath, "utf8"),
    "最终中文字幕",
  );
  validateEditableMasterTimeline(canonical);
  const translated = hasGeminiJson
    ? parseGeminiDisplaySubtitles(
        await fs.readFile(paths.translationTarget.jsonPath, "utf8"),
        "Gemini 翻译 JSON",
      )
    : parseTranslatedSubtitleTextDocument(
        await fs.readFile(paths.translationTarget.srtPath, "utf8"),
        "英文字幕译稿",
      );
  const canonicalByNumber = new Map(canonical.map((cue) => [cue.number, cue]));
  const translatedByNumber = new Map();
  for (const cue of translated) {
    if (!canonicalByNumber.has(cue.number)) {
      throw new Error(`英文字幕译稿包含主时间轴中不存在的编号：${cue.number}。`);
    }
    if (translatedByNumber.has(cue.number)) {
      throw new Error(`英文字幕译稿包含重复编号：${cue.number}。`);
    }
    translatedByNumber.set(cue.number, subtitleRoleAndText(cue.text).text);
  }
  await writeFileIfChanged(
    paths.translationTarget.editorDraftPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        importedFrom: hasGeminiJson ? paths.translationTarget.jsonPath : paths.translationTarget.srtPath,
        cues: canonical.map((cue) => {
          const canonicalParts = subtitleRoleAndText(cue.text);
          const english = translatedByNumber.get(cue.number) || nonSpeechEnglishFallback(canonicalParts.text);
          return {
            number: cue.number,
            role: canonicalParts.role,
            english,
            skipped: !english,
          };
        }),
      },
      null,
      2,
    ),
  );
  return {
    ...(await subtitleEditorState(record)),
    imported: true,
  };
}

async function saveSubtitleEditor(record, requestedCues) {
  if (activeEnglishDubbingTasks.get(record.id)?.status === "running") {
    throw new Error("英文配音正在运行，完成后再保存字幕修改。");
  }
  if (!Array.isArray(requestedCues)) {
    throw new Error("缺少字幕编辑内容。");
  }
  const paths = finalSubtitlesOutputPaths(record);
  if (!paths || !(await isFile(paths.srtPath))) {
    throw new Error("请先生成最终中文字幕。");
  }
  const canonical = parseEditableSubtitleDocument(
    await fs.readFile(paths.srtPath, "utf8"),
    "最终中文字幕",
  );
  validateEditableMasterTimeline(canonical);
  if (requestedCues.length !== canonical.length) {
    throw new Error(`字幕条目数量不一致：应为 ${canonical.length} 条。`);
  }
  const requestedByNumber = new Map();
  for (const requested of requestedCues) {
    if (!Number.isInteger(requested?.number) || requestedByNumber.has(requested.number)) {
      throw new Error("字幕编号缺失或重复。");
    }
    const role = typeof requested.role === "string" ? requested.role.trim() : "";
    const english = typeof requested.english === "string" ? requested.english.trim() : "";
    if (/[\[\]\r\n]/.test(role) || role.length > 80) {
      throw new Error(`第 ${requested.number} 段角色名格式无效。`);
    }
    if (english.length > 1000) {
      throw new Error(`第 ${requested.number} 段英文字幕过长。`);
    }
    requestedByNumber.set(requested.number, { role, english, skipped: !english });
  }
  const chineseCues = [];
  const englishCues = [];
  const savedDraftCues = [];
  for (const cue of canonical) {
    const requested = requestedByNumber.get(cue.number);
    if (!requested) {
      throw new Error(`缺少第 ${cue.number} 段字幕编辑内容。`);
    }
    const chinese = subtitleRoleAndText(cue.text).text;
    const english = requested.english || nonSpeechEnglishFallback(chinese);
    chineseCues.push({ ...cue, text: taggedSubtitleText(requested.role, chinese) });
    if (english) {
      englishCues.push({ ...cue, text: taggedSubtitleText(requested.role, english) });
    }
    savedDraftCues.push({
      number: cue.number,
      role: requested.role,
      english,
      skipped: !english,
    });
  }
  const chineseChanged = await writeFileIfChanged(
    paths.srtPath,
    serializeEditableSubtitleDocument(chineseCues),
  );
  await writeFileIfChanged(
    paths.translationTarget.editorDraftPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        cues: savedDraftCues,
      },
      null,
      2,
    ),
  );
  const englishChanged = englishCues.length > 0
    ? await writeFileIfChanged(
        paths.translationTarget.srtPath,
        serializeEditableSubtitleDocument(englishCues),
      )
    : await removeFileIfExists(paths.translationTarget.srtPath);
  return {
    ...(await subtitleEditorState(record)),
    saved: true,
    chineseChanged,
    englishChanged,
  };
}

async function openProjectPath(record, requestedPath) {
  if (!requestedPath || typeof requestedPath !== "string") {
    throw new Error("缺少需要打开的路径。");
  }
  const resolvedPath = path.resolve(requestedPath);
  if (!knownProjectPaths(record).has(resolvedPath.toLocaleLowerCase())) {
    throw new Error("该路径不属于当前项目产物。");
  }
  try {
    await fs.access(resolvedPath);
  } catch {
    throw new Error("文件尚未生成，无法打开。");
  }
  const child = spawn("explorer.exe", [resolvedPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function openProjectArtifact(record, requestedArtifactKey) {
  if (!requestedArtifactKey || typeof requestedArtifactKey !== "string") {
    throw new Error("缺少需要打开的项目产物。");
  }
  const artifactPath = artifactPathForKey(record, requestedArtifactKey);
  await openProjectPath(record, artifactPath);
}

function thumbnailPath(record) {
  return path.join(thumbnailDirectory, `${record.id}.jpg`);
}

async function ensureThumbnail(record) {
  const outputPath = thumbnailPath(record);
  if (await isFile(outputPath)) {
    return outputPath;
  }
  if (activeThumbnailTasks.has(record.id)) {
    return activeThumbnailTasks.get(record.id);
  }
  const task = (async () => {
    const ffmpegPath = path.join(ffmpegDirectory, "ffmpeg.exe");
    if (!(await isFile(ffmpegPath))) {
      throw new Error(`找不到 FFmpeg 程序：${ffmpegPath}`);
    }
    const temporaryPath = path.join(
      thumbnailDirectory,
      `${record.id}.${crypto.randomUUID()}.tmp.jpg`,
    );
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(
          ffmpegPath,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "1",
            "-i",
            sourceFilePath(record),
            "-frames:v",
            "1",
            "-vf",
            "scale=320:-2:force_original_aspect_ratio=decrease",
            "-q:v",
            "4",
            temporaryPath,
          ],
          { cwd: workflowRootDirectory, windowsHide: true },
        );
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`生成视频封面失败，FFmpeg 退出码：${code}`));
          }
        });
      });
      await fs.rename(temporaryPath, outputPath);
      return outputPath;
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  })();
  activeThumbnailTasks.set(record.id, task);
  try {
    return await task;
  } finally {
    activeThumbnailTasks.delete(record.id);
  }
}

async function bsRoformerStatus(record) {
  const outputs = bsRoformerOutputPaths(record);
  if (!outputs) {
    return {
      status: "unavailable",
      error: "该项目没有可执行的原视频路径。",
    };
  }
  const activeTask = activeBsRoformerTasks.get(record.id);
  const persistedJob = await jobStore.readJob(jobIdFor(record.id, "bs-roformer"));
  const task = recoverWorkflowTask(activeTask, persistedJob);
  const dialogueReady = await isFile(outputs.dialoguePath);
  const backgroundReady = await isFile(outputs.backgroundPath);
  let status = "ready";
  if (task?.status === "running") {
    status = "running";
  } else if (task?.status === "failed") {
    status = "failed";
  } else if (dialogueReady && backgroundReady) {
    status = "completed";
  }
  return {
    status,
    outputDirectory: outputs.outputDirectory,
    outputDirectoryReady: await isDirectory(outputs.outputDirectory),
    outputs: {
      dialogue: { path: outputs.dialoguePath, ready: dialogueReady },
      background: { path: outputs.backgroundPath, ready: backgroundReady },
    },
    startedAt: task?.startedAt || null,
    finishedAt: task?.finishedAt || null,
    logPath: task?.logPath || null,
    error: task?.error || null,
  };
}

async function startBsRoformer(record) {
  const paths = bsRoformerOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法执行二轨分离。");
  }
  if (activeBsRoformerTasks.get(record.id)?.status === "running") {
    return bsRoformerStatus(record);
  }
  if (!(await isFile(bsRoformerCoreScript))) {
    throw new Error(`找不到 BS-RoFormer 核心脚本：${bsRoformerCoreScript}`);
  }
  if (!(await isFile(bsRoformerPython))) {
    throw new Error(`找不到 BS-RoFormer Python 环境：${bsRoformerPython}`);
  }

  await fs.mkdir(bsRoformerTempDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${record.id}_BS-RoFormer.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const job = await jobStore.startJob({
    videoId: record.id,
    workflow: "bs-roformer",
    logPath,
  });
  const child = spawn(
    bsRoformerPython,
    [
      bsRoformerCoreScript,
      "--video",
      record.sourcePath,
      "--runtime-dir",
      bsRoformerRuntimeDirectory,
      "--output-root",
      paths.outputDirectory,
    ],
    {
      cwd: workflowRootDirectory,
      windowsHide: true,
      env: {
        ...process.env,
        HF_HOME: "D:\\models\\huggingface",
        HUGGINGFACE_HUB_CACHE: "D:\\models\\huggingface\\hub",
        PIP_CACHE_DIR: "D:\\models\\pip-cache",
        AUDIO_SEPARATOR_MODEL_DIR: bsRoformerModelDirectory,
        TEMP: bsRoformerTempDirectory,
        TMP: bsRoformerTempDirectory,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    },
  );
  const task = {
    id: job.id,
    status: "running",
    startedAt: job.startedAt,
    finishedAt: null,
    logPath,
    error: null,
  };
  activeBsRoformerTasks.set(record.id, task);
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on("error", async (error) => {
    task.status = "failed";
    task.error = error.message;
    task.finishedAt = new Date().toISOString();
    await jobStore.failJob(task.id, error.message);
    output.end(`\n任务启动失败：${error.message}\n`);
  });
  child.on("close", async (code) => {
    if (task.status !== "failed") {
      task.status = code === 0 ? "completed" : "failed";
      task.error = code === 0 ? null : `处理进程退出码：${code}`;
      task.finishedAt = new Date().toISOString();
      if (code === 0) {
        await jobStore.finishJob(task.id, "completed");
      } else {
        await jobStore.failJob(task.id, task.error);
      }
    }
    output.end(`\n任务状态：${task.status}\n`);
  });
  return bsRoformerStatus(record);
}

async function ocrStatus(record) {
  const outputs = ocrOutputPaths(record);
  if (!outputs) {
    return {
      status: "unavailable",
      error: "该项目没有可执行的原视频路径。",
    };
  }
  const activeTask = activeOcrTasks.get(record.id);
  const persistedJob = await jobStore.readJob(jobIdFor(record.id, OCR_SUBTITLES_WORKFLOW));
  const task = recoverWorkflowTask(activeTask, persistedJob);
  const srtReady = await isFile(outputs.srtPath);
  const reportReady = await isFile(outputs.reportPath);
  let status = "ready";
  if (task?.status === "running") {
    status = "running";
  } else if (task?.status === "failed") {
    status = "failed";
  } else if (srtReady) {
    status = "completed";
  }
  return {
    status,
    outputDirectory: outputs.outputDirectory,
    outputDirectoryReady: await isDirectory(outputs.outputDirectory),
    outputs: {
      srt: { path: outputs.srtPath, ready: srtReady },
      report: { path: outputs.reportPath, ready: reportReady },
    },
    startedAt: task?.startedAt || null,
    finishedAt: task?.finishedAt || null,
    stage: task?.stage || null,
    logPath: task?.logPath || null,
    error: task?.error || null,
  };
}

async function startOcr(record) {
  const paths = ocrOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法执行 OCR 字幕提取。");
  }
  if (activeOcrTasks.get(record.id)?.status === "running") {
    return ocrStatus(record);
  }
  for (const [label, filePath] of [
    ["GPU OCR 脚本", subtitleOcrCoreScript],
    ["GPU OCR Python 环境", subtitleOcrPython],
    ["FunASR 标点脚本", punctuationCoreScript],
    ["FunASR Python 环境", punctuationPython],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }
  await fs.mkdir(bsRoformerTempDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${record.id}_OCR_字幕校准.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const job = await jobStore.startJob({
    videoId: record.id,
    workflow: OCR_SUBTITLES_WORKFLOW,
    logPath,
    stage: "ocr",
  });
  const task = {
    id: job.id,
    status: "running",
    stage: job.stage,
    startedAt: job.startedAt,
    finishedAt: null,
    logPath,
    error: null,
  };
  activeOcrTasks.set(record.id, task);
  const ocrEnvironment = {
    ...process.env,
    PADDLE_PDX_CACHE_HOME: "D:\\models\\paddle",
    PADDLEX_HOME: "D:\\models\\paddle",
    PADDLE_HOME: "D:\\models\\paddle",
    MODEL_HOME: "D:\\models\\paddle",
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
    PIP_CACHE_DIR: "D:\\models\\pip-cache",
    TEMP: bsRoformerTempDirectory,
    TMP: bsRoformerTempDirectory,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
  const punctuationEnvironment = {
    ...process.env,
    MODELSCOPE_CACHE: "D:\\models\\modelscope",
    MODELSCOPE_HOME: "D:\\models\\modelscope",
    PIP_CACHE_DIR: "D:\\models\\pip-cache",
    TEMP: bsRoformerTempDirectory,
    TMP: bsRoformerTempDirectory,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PATH: `${torchLibraryDirectory};${process.env.PATH || ""}`,
  };

  async function fail(message) {
    if (task.status === "failed") {
      return;
    }
    task.status = "failed";
    task.error = message;
    task.finishedAt = new Date().toISOString();
    try {
      await jobStore.failJob(task.id, message, { stage: task.stage });
    } catch (error) {
      output.write(`\n写入任务状态失败：${error.message}\n`);
    } finally {
      output.end(`\n任务状态：failed\n${message}\n`);
    }
  }

  async function runPunctuation() {
    task.stage = "punctuation";
    await jobStore.updateJob(task.id, { stage: "punctuation" });
    output.write("\n开始 FunASR 标点恢复...\n");
    const punctuationProcess = spawn(
      punctuationPython,
      [punctuationCoreScript, "--ocr-json", paths.dataPath],
      { cwd: workflowRootDirectory, windowsHide: true, env: punctuationEnvironment },
    );
    punctuationProcess.stdout.pipe(output, { end: false });
    punctuationProcess.stderr.pipe(output, { end: false });
    punctuationProcess.on("error", (error) => {
      void fail(`FunASR 启动失败：${error.message}`);
    });
    punctuationProcess.on("close", async (code) => {
      if (task.status === "failed") {
        return;
      }
      if (code !== 0) {
        void fail(`FunASR 标点恢复退出码：${code}`);
        return;
      }
      task.status = "completed";
      task.stage = "completed";
      task.finishedAt = new Date().toISOString();
      try {
        await jobStore.finishJob(task.id, "completed", { stage: "completed" });
      } catch (error) {
        output.write(`\n写入任务状态失败：${error.message}\n`);
      } finally {
        output.end("\n任务状态：completed\n");
      }
    });
  }

  const ocrProcess = spawn(
    subtitleOcrPython,
    [
      subtitleOcrCoreScript,
      "--video",
      record.sourcePath,
      "--runtime-dir",
      bsRoformerRuntimeDirectory,
      "--output-dir",
      paths.outputDirectory,
      "--sample-fps",
      "5",
      "--ocr-profile",
      "quality",
      "--batch-size",
      "24",
    ],
    { cwd: workflowRootDirectory, windowsHide: true, env: ocrEnvironment },
  );
  ocrProcess.stdout.pipe(output, { end: false });
  ocrProcess.stderr.pipe(output, { end: false });
  ocrProcess.on("error", (error) => {
    void fail(`GPU OCR 启动失败：${error.message}`);
  });
  ocrProcess.on("close", (code) => {
    if (task.status === "failed") {
      return;
    }
    if (code !== 0) {
      void fail(`GPU OCR 提取退出码：${code}`);
      return;
    }
    void runPunctuation().catch((error) => {
      void fail(`FunASR 标点恢复启动失败：${error.message}`);
    });
  });
  return ocrStatus(record);
}

async function whisperxStatus(record) {
  const outputs = whisperxOutputPaths(record);
  if (!outputs) {
    return {
      status: "unavailable",
      canRun: false,
      error: "该项目没有可执行的原视频路径。",
    };
  }
  const activeTask = activeWhisperxTasks.get(record.id);
  const persistedJob = await jobStore.readJob(jobIdFor(record.id, WHISPERX_SPEAKERS_WORKFLOW));
  const task = recoverWorkflowTask(activeTask, persistedJob);
  const dialogueReady = await isFile(outputs.inputPath);
  const srtReady = await isFile(outputs.srtPath);
  const jsonReady = await isFile(outputs.jsonPath);
  let status = dialogueReady ? "ready" : "blocked";
  if (task?.status === "running") {
    status = "running";
  } else if (task?.status === "failed") {
    status = "failed";
  } else if (srtReady && jsonReady) {
    status = "completed";
  }
  return {
    status,
    canRun: dialogueReady,
    inputPath: outputs.inputPath,
    outputDirectory: outputs.outputDirectory,
    outputDirectoryReady: await isDirectory(outputs.outputDirectory),
    outputs: {
      srt: { path: outputs.srtPath, ready: srtReady },
      json: { path: outputs.jsonPath, ready: jsonReady },
    },
    startedAt: task?.startedAt || null,
    finishedAt: task?.finishedAt || null,
    logPath: task?.logPath || null,
    error: task?.error || null,
  };
}

async function startWhisperx(record) {
  const paths = whisperxOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法执行 WhisperX。");
  }
  if (!(await isFile(paths.inputPath))) {
    throw new Error("未生成 DX 对白轨，请先完成 BS-RoFormer 二轨分离。");
  }
  if (activeWhisperxTasks.get(record.id)?.status === "running") {
    return whisperxStatus(record);
  }
  for (const [label, filePath] of [
    ["WhisperX 脚本", whisperxCoreScript],
    ["WhisperX Python 环境", whisperxPython],
    ["Hugging Face 访问令牌", whisperxTokenPath],
    ["FFmpeg 程序", path.join(ffmpegDirectory, "ffmpeg.exe")],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }

  await fs.mkdir(bsRoformerTempDirectory, { recursive: true });
  await fs.mkdir(whisperxModelDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${record.id}_WhisperX_说话人字幕.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const job = await jobStore.startJob({
    videoId: record.id,
    workflow: WHISPERX_SPEAKERS_WORKFLOW,
    logPath,
  });
  const task = activeTaskFromJob(job);
  activeWhisperxTasks.set(record.id, task);

  async function fail(message) {
    if (task.status === "failed") {
      return;
    }
    task.status = "failed";
    task.error = message;
    task.finishedAt = new Date().toISOString();
    try {
      await jobStore.failJob(task.id, message);
    } catch (error) {
      output.write(`\n写入任务状态失败：${error.message}\n`);
    } finally {
      output.end(`\n任务状态：failed\n${message}\n`);
    }
  }

  const child = spawn(
    whisperxPython,
    [
      whisperxCoreScript,
      "--audio",
      paths.inputPath,
      "--runtime-dir",
      bsRoformerRuntimeDirectory,
      "--token-file",
      whisperxTokenPath,
      "--model",
      "large-v3",
      "--batch-size",
      "4",
    ],
    {
      cwd: workflowRootDirectory,
      windowsHide: true,
      env: {
        ...process.env,
        HF_HOME: "D:\\models\\huggingface",
        HUGGINGFACE_HUB_CACHE: "D:\\models\\huggingface\\hub",
        PIP_CACHE_DIR: "D:\\models\\pip-cache",
        TORCH_HOME: "D:\\models\\torch",
        TEMP: bsRoformerTempDirectory,
        TMP: bsRoformerTempDirectory,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        PATH: `${torchLibraryDirectory};${ffmpegDirectory};${process.env.PATH || ""}`,
      },
    },
  );
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on("error", (error) => {
    void fail(`WhisperX 启动失败：${error.message}`);
  });
  child.on("close", async (code) => {
    if (task.status === "failed") {
      return;
    }
    if (code !== 0) {
      void fail(`WhisperX 处理退出码：${code}`);
      return;
    }
    task.status = "completed";
    task.error = null;
    task.finishedAt = new Date().toISOString();
    try {
      await jobStore.finishJob(task.id, "completed");
    } catch (error) {
      output.write(`\n写入任务状态失败：${error.message}\n`);
    } finally {
      output.end(`\n任务状态：${task.status}\n`);
    }
  });
  return whisperxStatus(record);
}

async function finalSubtitlesStatus(record) {
  const paths = finalSubtitlesOutputPaths(record);
  if (!paths) {
    return {
      status: "unavailable",
      canRun: false,
      error: "该项目没有可执行的原视频路径。",
    };
  }
  const task = activeFinalSubtitlesTasks.get(record.id);
  const inputEntries = await Promise.all(
    Object.entries(paths.inputs).map(async ([key, inputPath]) => [
      key,
      { path: inputPath, ready: await isFile(inputPath) },
    ]),
  );
  const inputs = Object.fromEntries(inputEntries);
  const canRun = Object.values(inputs).every((input) => input.ready);
  const srtReady = await isFile(paths.srtPath);
  let status = canRun ? "ready" : "blocked";
  if (task?.status === "running") {
    status = "running";
  } else if (task?.status === "failed") {
    status = "failed";
  } else if (srtReady) {
    status = "completed";
  }
  return {
    status,
    canRun,
    inputs,
    outputDirectory: paths.outputDirectory,
    outputDirectoryReady: await isDirectory(paths.outputDirectory),
    outputs: {
      srt: { path: paths.srtPath, ready: srtReady },
    },
    translationTarget: {
      ...paths.translationTarget,
      outputDirectoryReady: await isDirectory(paths.translationTarget.outputDirectory),
      jsonReady: await isFile(paths.translationTarget.jsonPath),
      srtReady: await isFile(paths.translationTarget.srtPath),
    },
    controlledTarget: {
      ...paths.controlledTarget,
      srtReady: await isFile(paths.controlledTarget.srtPath),
      reportReady: await isFile(paths.controlledTarget.reportPath),
    },
    startedAt: task?.startedAt || null,
    finishedAt: task?.finishedAt || null,
    logPath: task?.logPath || null,
    error: task?.error || null,
  };
}

async function startFinalSubtitles(record) {
  const paths = finalSubtitlesOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法合并最终中文字幕。");
  }
  const missingInputs = [];
  for (const inputPath of Object.values(paths.inputs)) {
    if (!(await isFile(inputPath))) {
      missingInputs.push(inputPath);
    }
  }
  if (missingInputs.length > 0) {
    throw new Error(`合并所需字幕尚未齐全：${missingInputs.join("；")}`);
  }
  if (activeFinalSubtitlesTasks.get(record.id)?.status === "running") {
    return finalSubtitlesStatus(record);
  }
  for (const [label, filePath] of [
    ["最终中文字幕合并脚本", finalSubtitlesCoreScript],
    ["Python 环境", finalSubtitlesPython],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }

  const logPath = path.join(logDirectory, `${record.id}_最终中文字幕.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const child = spawn(
    finalSubtitlesPython,
    [
      finalSubtitlesCoreScript,
      "--speaker-srt",
      paths.inputs.speakerSrt,
      "--ocr-srt",
      paths.inputs.ocrSrt,
      "--output-dir",
      paths.outputDirectory,
      "--video-stem",
      paths.videoStem,
    ],
    {
      cwd: workflowRootDirectory,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    },
  );
  const task = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logPath,
    error: null,
  };
  activeFinalSubtitlesTasks.set(record.id, task);
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on("error", (error) => {
    task.status = "failed";
    task.error = `中文字幕合并启动失败：${error.message}`;
    task.finishedAt = new Date().toISOString();
    output.end(`\n任务状态：failed\n${task.error}\n`);
  });
  child.on("close", (code) => {
    if (task.status !== "failed") {
      task.status = code === 0 ? "completed" : "failed";
      task.error = code === 0 ? null : `中文字幕合并退出码：${code}`;
      task.finishedAt = new Date().toISOString();
    }
    output.end(`\n任务状态：${task.status}\n`);
  });
  return finalSubtitlesStatus(record);
}

async function englishDubbingStatus(record) {
  const paths = englishDubbingOutputPaths(record);
  if (!paths) {
    return {
      status: "unavailable",
      canRun: false,
      error: "该项目没有可执行的原视频路径。",
    };
  }
  const task = activeEnglishDubbingTasks.get(record.id);
  const inputEntries = await Promise.all(
    Object.entries(paths.inputs).map(async ([key, inputPath]) => [
      key,
      { path: inputPath, ready: await isFile(inputPath) },
    ]),
  );
  const inputs = Object.fromEntries(inputEntries);
  const editor = await subtitleEditorState(record);
  const canRun =
    editor.canEdit &&
    inputs.chineseTimelineSrt.ready &&
    inputs.englishDraftSrt.ready &&
    inputs.dialogue.ready &&
    inputs.background.ready;
  const preflightReportReady = await isFile(paths.preflightReportPath);
  const dubbingGroupsCsvReady = await isFile(paths.dubbingGroupsCsvPath);
  const dubbingGroupsJsonReady = await isFile(paths.dubbingGroupsJsonPath);
  const dubbingGroupsReportReady = await isFile(paths.dubbingGroupsReportPath);
  const segmentManifestReady = await isFile(paths.segmentManifestPath);
  const dubbingManifestReady = await isFile(paths.dubbingManifestPath);
  const dubbingReportReady = await isFile(paths.dubbingReportPath);
  const dialogueTrackReady = await isFile(paths.dialogueTrackPath);
  const mixedTrackReady = await isFile(paths.mixedTrackPath);
  const assemblyReportReady = await isFile(paths.assemblyReportPath);
  const [canonicalTime, draftTime, controlledTime, preflightTime, dialogueTime, backgroundTime, sourceTime, mixedTime] =
    await Promise.all([
      modificationTime(paths.inputs.chineseTimelineSrt),
      modificationTime(paths.inputs.englishDraftSrt),
      modificationTime(paths.inputs.englishSrt),
      modificationTime(paths.preflightReportPath),
      modificationTime(paths.inputs.dialogue),
      modificationTime(paths.inputs.background),
      modificationTime(record.sourcePath),
      modificationTime(paths.mixedTrackPath),
    ]);
  const preflightOutdated =
    controlledTime === null ||
    preflightTime === null ||
    [canonicalTime, draftTime].some(
      (inputTime) => inputTime !== null && inputTime > preflightTime,
    );
  const mixOutdated =
    preflightOutdated ||
    mixedTime === null ||
    [controlledTime, dialogueTime, backgroundTime, sourceTime].some(
      (inputTime) => inputTime !== null && inputTime > mixedTime,
    );
  const canRedub =
    canRun &&
    segmentManifestReady &&
    dubbingManifestReady &&
    dialogueTrackReady &&
    mixedTrackReady &&
    !mixOutdated;
  let status = canRun ? "ready" : "blocked";
  if (task?.status === "running") {
    status = "running";
  } else if (task?.status === "failed") {
    status = "failed";
  } else if (mixedTrackReady && dialogueTrackReady && !mixOutdated) {
    status = "completed";
  }
  const dubbingProgress = await readVoxCpmProgress(paths.progressLogPath);
  return {
    status,
    canRun,
    canRedub,
    editorComplete: Boolean(editor.complete),
    skippedEnglishNumbers: editor.cues.filter((cue) => cue.skipped).map((cue) => cue.number),
    missingEnglishNumbers: editor.missingEnglishNumbers || [],
    preflightOutdated,
    mixOutdated,
    stage: task?.stage || null,
    dubbingProgress,
    inputs,
    workDirectory: paths.workDirectory,
    workDirectoryReady: await isDirectory(paths.workDirectory),
    outputs: {
      controlledEnglishSrt: { path: paths.inputs.englishSrt, ready: inputs.englishSrt.ready },
      preflightReport: { path: paths.preflightReportPath, ready: preflightReportReady },
      dubbingGroupsCsv: { path: paths.dubbingGroupsCsvPath, ready: dubbingGroupsCsvReady },
      dubbingGroupsJson: { path: paths.dubbingGroupsJsonPath, ready: dubbingGroupsJsonReady },
      dubbingGroupsReport: { path: paths.dubbingGroupsReportPath, ready: dubbingGroupsReportReady },
      segmentManifest: { path: paths.segmentManifestPath, ready: segmentManifestReady },
      dubbingManifest: { path: paths.dubbingManifestPath, ready: dubbingManifestReady },
      dubbingReport: { path: paths.dubbingReportPath, ready: dubbingReportReady },
      dialogueTrack: { path: paths.dialogueTrackPath, ready: dialogueTrackReady },
      mixedTrack: { path: paths.mixedTrackPath, ready: mixedTrackReady },
      assemblyReport: { path: paths.assemblyReportPath, ready: assemblyReportReady },
    },
    startedAt: task?.startedAt || null,
    finishedAt: task?.finishedAt || null,
    logPath: task?.logPath || null,
    redubSegmentNumber: task?.redubSegmentNumber || null,
    error: task?.error || null,
  };
}

async function startEnglishDubbing(record) {
  const paths = englishDubbingOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法执行英文配音混音。");
  }
  const editor = await subtitleEditorState(record);
  if (!editor.canEdit) {
    throw new Error("英文字幕编辑器尚未准备好，无法开始配音。");
  }
  const missingRequiredInputs = [];
  for (const inputPath of [
    paths.inputs.chineseTimelineSrt,
    paths.inputs.englishDraftSrt,
    paths.inputs.dialogue,
    paths.inputs.background,
  ]) {
    if (!(await isFile(inputPath))) {
      missingRequiredInputs.push(inputPath);
    }
  }
  if (missingRequiredInputs.length > 0) {
    throw new Error(`英文配音所需输入尚未齐全：${missingRequiredInputs.join("；")}`);
  }
  if (activeEnglishDubbingTasks.get(record.id)?.status === "running") {
    return englishDubbingStatus(record);
  }
  for (const [label, filePath] of [
    ["英文字幕预检脚本", controlledEnglishSubtitlesCoreScript],
    ["英文配音整句分段规划脚本", planEnglishDubbingGroupsScript],
    ["分段切割脚本", splitDubbingCoreScript],
    ["VoxCPM 配音脚本", voxCpmCoreScript],
    ["整轨混音脚本", assembleEnglishTrackScript],
    ["字幕处理 Python 环境", punctuationPython],
    ["VoxCPM Python 环境", voxCpmPython],
    ["FFmpeg 程序", path.join(ffmpegDirectory, "ffmpeg.exe")],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }

  await fs.mkdir(paths.workDirectory, { recursive: true });
  await fs.mkdir(voxCpmTempDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${record.id}_VoxCPM_英文配音混音.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const task = {
    status: "running",
    stage: "preflight",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logPath,
    error: null,
  };
  activeEnglishDubbingTasks.set(record.id, task);

  const commonEnvironment = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PATH: `${ffmpegDirectory};${process.env.PATH || ""}`,
  };
  const ttsEnvironment = {
    ...commonEnvironment,
    HF_HOME: "D:\\models\\huggingface",
    HF_HUB_CACHE: "D:\\models\\huggingface\\hub",
    HUGGINGFACE_HUB_CACHE: "D:\\models\\huggingface\\hub",
    MODELSCOPE_CACHE: "D:\\models\\modelscope",
    TORCH_HOME: "D:\\models\\torch",
    PIP_CACHE_DIR: "D:\\models\\pip-cache",
    TEMP: voxCpmTempDirectory,
    TMP: voxCpmTempDirectory,
  };

  function runProcess(filePath, arguments_, environment) {
    return new Promise((resolve, reject) => {
      const child = spawn(filePath, arguments_, {
        cwd: workflowRootDirectory,
        windowsHide: true,
        env: environment,
      });
      let started = true;
      child.stdout.pipe(output, { end: false });
      child.stderr.pipe(output, { end: false });
      child.on("error", (error) => {
        started = false;
        reject(error);
      });
      child.on("close", (code) => {
        if (!started) {
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`处理进程退出码：${code}`));
        }
      });
    });
  }

  void (async () => {
    try {
      output.write("步骤 1/5：同步主时间轴并预检英文字幕译稿。\n");
      await runProcess(
        punctuationPython,
        [
          controlledEnglishSubtitlesCoreScript,
          "--canonical-srt",
          paths.inputs.chineseTimelineSrt,
          "--translated-srt",
          paths.inputs.englishDraftSrt,
          "--output-srt",
          paths.inputs.englishSrt,
          "--report-json",
          paths.preflightReportPath,
        ],
        commonEnvironment,
      );
      const subtitleStats = await fs.stat(paths.inputs.englishSrt);
      task.stage = "dubbing-groups";
      output.write("\n步骤 2/5：生成 Gemini 整句配音分段规划。\n");
      const groupArguments = [
        planEnglishDubbingGroupsScript,
        "--subtitle",
        paths.inputs.englishSrt,
        "--output-csv",
        paths.dubbingGroupsCsvPath,
        "--output-json",
        paths.dubbingGroupsJsonPath,
        "--output-html",
        paths.dubbingGroupsReportPath,
        "--output-subtitle",
        paths.dubbingGroupsDisplaySrtPath,
      ];
      if (await isFile(paths.inputs.geminiTranslationJson)) {
        groupArguments.push("--gemini-json", paths.inputs.geminiTranslationJson);
      }
      await runProcess(punctuationPython, groupArguments, commonEnvironment);
      const dubbingGroupsStats = await fs.stat(paths.dubbingGroupsCsvPath);
      const dialogueStats = await fs.stat(paths.inputs.dialogue);
      const sourceAudioStats = await fs.stat(record.sourcePath);
      const segmentManifestStats = await fs.stat(paths.segmentManifestPath).catch(() => null);
      const dialogueChanged =
        segmentManifestStats && dialogueStats.mtimeMs > segmentManifestStats.mtimeMs;
      const sourceAudioChanged =
        segmentManifestStats && sourceAudioStats.mtimeMs > segmentManifestStats.mtimeMs;
      const regenerateSegments =
        !segmentManifestStats ||
        subtitleStats.mtimeMs > segmentManifestStats.mtimeMs ||
        dubbingGroupsStats.mtimeMs > segmentManifestStats.mtimeMs ||
        dialogueChanged ||
        sourceAudioChanged;
      task.stage = "segments";
      output.write("\n步骤 3/5：按整句分段切割 DX 对白轨。\n");
      if (regenerateSegments) {
        const segmentArguments = [
          splitDubbingCoreScript,
          "--dubbing-plan",
          paths.dubbingGroupsCsvPath,
          "--audio",
          paths.inputs.dialogue,
          "--preserve-audio",
          record.sourcePath,
          "--output-dir",
          paths.workDirectory,
        ];
        if (dialogueChanged || sourceAudioChanged) {
          segmentArguments.push("--overwrite");
        } else if (segmentManifestStats) {
          segmentArguments.push("--update");
        }
        await runProcess(punctuationPython, segmentArguments, commonEnvironment);
      } else {
        output.write(`英文字幕未变更，复用分段清单：${paths.segmentManifestPath}\n`);
      }

      task.stage = "dubbing";
      const dubbingArguments = [
        voxCpmCoreScript,
        "--manifest",
        paths.segmentManifestPath,
        "--output-dir",
        paths.dubbingDirectory,
        "--model-id",
        voxCpmModelId,
        "--progress-log",
        paths.progressLogPath,
        "--device",
        "cuda",
        "--cfg-value",
        "2.0",
        "--inference-timesteps",
        "10",
        "--normalize",
        "--per-segment-reference",
      ];
      output.write("\n步骤 4/5：使用 VoxCPM2 生成英文配音。\n");
      output.write("VoxCPM 将复用未变更片段，仅生成或重新适配受影响片段。\n");
      await runProcess(
        voxCpmPython,
        dubbingArguments,
        ttsEnvironment,
      );

      task.stage = "mixing";
      output.write("\n步骤 5/5：铺设英文对白整轨并与 MX+FX 背景底轨混音。\n");
      await runProcess(
        punctuationPython,
        [
          assembleEnglishTrackScript,
          "--manifest",
          paths.dubbingManifestPath,
          "--output-dir",
          paths.assemblyDirectory,
          "--output-prefix",
          paths.videoStem,
          "--timeline-reference",
          paths.inputs.background,
          "--background",
          paths.inputs.background,
          "--overwrite",
        ],
        commonEnvironment,
      );
      task.status = "completed";
      task.stage = "completed";
      task.finishedAt = new Date().toISOString();
      output.end("\n任务状态：completed\n");
    } catch (error) {
      task.status = "failed";
      task.error = `英文配音混音失败：${error.message}`;
      task.finishedAt = new Date().toISOString();
      output.end(`\n任务状态：failed\n${task.error}\n`);
    }
  })();
  return englishDubbingStatus(record);
}

async function startSingleEnglishDubbingRedub(record, segmentNumberValue) {
  const paths = englishDubbingOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法执行单条重新配音。");
  }
  const segmentNumber = Number(segmentNumberValue);
  if (!Number.isInteger(segmentNumber) || segmentNumber < 1) {
    throw new Error("请输入大于等于 1 的配音分段编号。");
  }
  if (activeEnglishDubbingTasks.get(record.id)?.status === "running") {
    return englishDubbingStatus(record);
  }
  const status = await englishDubbingStatus(record);
  if (!status.canRedub) {
    throw new Error("请先完成步骤 06 的英文配音与混音，再执行单条重新配音。");
  }
  for (const [label, filePath] of [
    ["英文配音分段清单", paths.segmentManifestPath],
    ["VoxCPM 英文配音清单", paths.dubbingManifestPath],
    ["VoxCPM 配音脚本", voxCpmCoreScript],
    ["整轨混音脚本", assembleEnglishTrackScript],
    ["VoxCPM Python 环境", voxCpmPython],
    ["字幕处理 Python 环境", punctuationPython],
    ["FFmpeg 程序", path.join(ffmpegDirectory, "ffmpeg.exe")],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }

  await fs.mkdir(paths.dubbingDirectory, { recursive: true });
  await fs.mkdir(paths.assemblyDirectory, { recursive: true });
  await fs.mkdir(voxCpmTempDirectory, { recursive: true });
  const paddedSegmentNumber = String(segmentNumber).padStart(3, "0");
  const logPath = path.join(
    logDirectory,
    `${record.id}_VoxCPM_单条重新配音_${paddedSegmentNumber}.log`,
  );
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const task = {
    status: "running",
    stage: "redubbing",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logPath,
    error: null,
    redubSegmentNumber: segmentNumber,
  };
  activeEnglishDubbingTasks.set(record.id, task);

  const commonEnvironment = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PATH: `${ffmpegDirectory};${process.env.PATH || ""}`,
  };
  const ttsEnvironment = {
    ...commonEnvironment,
    HF_HOME: "D:\\models\\huggingface",
    HF_HUB_CACHE: "D:\\models\\huggingface\\hub",
    HUGGINGFACE_HUB_CACHE: "D:\\models\\huggingface\\hub",
    MODELSCOPE_CACHE: "D:\\models\\modelscope",
    TORCH_HOME: "D:\\models\\torch",
    PIP_CACHE_DIR: "D:\\models\\pip-cache",
    TEMP: voxCpmTempDirectory,
    TMP: voxCpmTempDirectory,
  };

  function runProcess(filePath, arguments_, environment) {
    return new Promise((resolve, reject) => {
      const child = spawn(filePath, arguments_, {
        cwd: workflowRootDirectory,
        windowsHide: true,
        env: environment,
      });
      let started = true;
      child.stdout.pipe(output, { end: false });
      child.stderr.pipe(output, { end: false });
      child.on("error", (error) => {
        started = false;
        reject(error);
      });
      child.on("close", (code) => {
        if (!started) {
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`处理进程退出码：${code}`));
        }
      });
    });
  }

  void (async () => {
    try {
      output.write(`步骤 1/2：重新生成第 ${paddedSegmentNumber} 段 VoxCPM 英文配音。\n`);
      await runProcess(
        voxCpmPython,
        [
          voxCpmCoreScript,
          "--manifest",
          paths.segmentManifestPath,
          "--output-dir",
          paths.dubbingDirectory,
          "--model-id",
          voxCpmModelId,
          "--progress-log",
          paths.progressLogPath,
          "--device",
          "cuda",
          "--cfg-value",
          "2.0",
          "--inference-timesteps",
          "10",
          "--normalize",
          "--per-segment-reference",
          "--segment-number",
          String(segmentNumber),
          "--overwrite",
        ],
        ttsEnvironment,
      );

      task.stage = "mixing";
      output.write(`\n步骤 2/2：用第 ${paddedSegmentNumber} 段新配音重新合成英文混音。\n`);
      await runProcess(
        punctuationPython,
        [
          assembleEnglishTrackScript,
          "--manifest",
          paths.dubbingManifestPath,
          "--output-dir",
          paths.assemblyDirectory,
          "--output-prefix",
          paths.videoStem,
          "--timeline-reference",
          paths.inputs.background,
          "--background",
          paths.inputs.background,
          "--overwrite",
        ],
        commonEnvironment,
      );
      task.status = "completed";
      task.stage = "completed";
      task.finishedAt = new Date().toISOString();
      output.end("\n任务状态：completed\n");
    } catch (error) {
      task.status = "failed";
      task.error = `第 ${paddedSegmentNumber} 段重新配音失败：${error.message}`;
      task.finishedAt = new Date().toISOString();
      output.end(`\n任务状态：failed\n${task.error}\n`);
    }
  })();
  return englishDubbingStatus(record);
}

function finalVideoArguments(paths, style, previewOnly = false) {
  const arguments_ = [
    renderEnglishVideoScript,
    "--video",
    paths.inputs.video,
    "--subtitle",
    paths.inputs.subtitle,
    "--output-dir",
    paths.outputDirectory,
    "--output-prefix",
    paths.prefix,
    "--font-name",
    style.fontName,
    "--font-size",
    String(style.fontSize),
    "--text-color",
    style.textColor,
    "--background-color",
    style.backgroundColor,
    "--background-opacity",
    String(style.backgroundOpacity),
    "--bottom-margin",
    String(style.bottomMargin),
    "--overwrite",
  ];
  if (previewOnly) {
    arguments_.push("--preview-only");
  } else {
    arguments_.push("--audio", paths.inputs.audio, "--crf", "18", "--preset", "medium");
  }
  return arguments_;
}

function finalVideoEnvironment() {
  return {
    ...process.env,
    PATH: `${ffmpegDirectory};${process.env.PATH || ""}`,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

async function finalVideoStatus(record) {
  const paths = finalVideoOutputPaths(record);
  if (!paths) {
    return {
      status: "unavailable",
      canRun: false,
      canPreview: false,
      error: "该项目没有可执行的原视频路径。",
    };
  }
  const task = activeFinalVideoTasks.get(record.id);
  const inputEntries = await Promise.all(
    Object.entries(paths.inputs).map(async ([key, inputPath]) => [
      key,
      { path: inputPath, ready: await isFile(inputPath) },
    ]),
  );
  const inputs = Object.fromEntries(inputEntries);
  const dubbingStatus = await englishDubbingStatus(record);
  const canPreview =
    inputs.video.ready && inputs.subtitle.ready && !dubbingStatus.preflightOutdated;
  const canRun = canPreview && inputs.audio.ready && dubbingStatus.status === "completed";
  const styledAssReady = await isFile(paths.styledAssPath);
  const videoReady = await isFile(paths.videoPath);
  const reportReady = await isFile(paths.reportPath);
  const [videoInputTime, audioTime, subtitleTime, outputVideoTime] = await Promise.all([
    modificationTime(paths.inputs.video),
    modificationTime(paths.inputs.audio),
    modificationTime(paths.inputs.subtitle),
    modificationTime(paths.videoPath),
  ]);
  const videoOutdated =
    outputVideoTime === null ||
    [videoInputTime, audioTime, subtitleTime].some(
      (inputTime) => inputTime !== null && inputTime > outputVideoTime,
    );
  const previews = await Promise.all(
    paths.previewPaths.map(async (previewPath, index) => ({
      path: previewPath,
      ready: await isFile(previewPath),
      url: `/api/videos/${record.id}/workflow/final-video/previews/${index + 1}`,
    })),
  );
  let status = canRun ? "ready" : "blocked";
  if (task?.status === "running") {
    status = "running";
  } else if (task?.status === "failed") {
    status = "failed";
  } else if (videoReady && reportReady && canRun && !videoOutdated) {
    status = "completed";
  }
  return {
    status,
    canRun,
    canPreview,
    videoOutdated,
    inputs,
    style: finalVideoStyles.get(record.id) || finalVideoStyle(),
    outputDirectory: paths.outputDirectory,
    outputDirectoryReady:
      styledAssReady || videoReady || reportReady || previews.some((preview) => preview.ready),
    previews,
    outputs: {
      styledAss: { path: paths.styledAssPath, ready: styledAssReady },
      video: { path: paths.videoPath, ready: videoReady },
      report: { path: paths.reportPath, ready: reportReady },
    },
    startedAt: task?.startedAt || null,
    finishedAt: task?.finishedAt || null,
    logPath: task?.logPath || null,
    error: task?.error || null,
  };
}

async function generateFinalVideoPreview(record, requestedStyle) {
  const paths = finalVideoOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法生成字幕参考帧。");
  }
  if ((await englishDubbingStatus(record)).preflightOutdated) {
    throw new Error("英文译稿或主时间轴已变化，请先执行英文配音步骤中的字幕预检。");
  }
  if (!(await isFile(paths.inputs.subtitle))) {
    throw new Error("未找到最终英文字幕 SRT，无法生成字幕参考帧。");
  }
  for (const [label, filePath] of [
    ["原视频", paths.inputs.video],
    ["视频成片脚本", renderEnglishVideoScript],
    ["Python 环境", punctuationPython],
    ["FFmpeg 程序", path.join(ffmpegDirectory, "ffmpeg.exe")],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }
  const style = finalVideoStyle(requestedStyle);
  finalVideoStyles.set(record.id, style);
  await fs.mkdir(paths.outputDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${record.id}_最终成片_字幕参考帧.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  await new Promise((resolve, reject) => {
    const child = spawn(
      punctuationPython,
      finalVideoArguments(paths, style, true),
      {
        cwd: workflowRootDirectory,
        windowsHide: true,
        env: finalVideoEnvironment(),
      },
    );
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`字幕参考帧生成退出码：${code}`));
      }
    });
  }).finally(() => output.end());
  return finalVideoStatus(record);
}

async function startFinalVideo(record, requestedStyle) {
  const paths = finalVideoOutputPaths(record);
  if (!paths) {
    throw new Error("该项目没有原视频路径，无法生成最终成片。");
  }
  const dubbingStatus = await englishDubbingStatus(record);
  if (dubbingStatus.status !== "completed") {
    throw new Error("英文译稿、主时间轴或音轨已变化，请先重新执行英文配音与混音。");
  }
  const missingInputs = [];
  for (const inputPath of Object.values(paths.inputs)) {
    if (!(await isFile(inputPath))) {
      missingInputs.push(inputPath);
    }
  }
  if (missingInputs.length > 0) {
    throw new Error(`最终成片所需输入尚未齐全：${missingInputs.join("；")}`);
  }
  if (activeFinalVideoTasks.get(record.id)?.status === "running") {
    return finalVideoStatus(record);
  }
  for (const [label, filePath] of [
    ["视频成片脚本", renderEnglishVideoScript],
    ["Python 环境", punctuationPython],
    ["FFmpeg 程序", path.join(ffmpegDirectory, "ffmpeg.exe")],
  ]) {
    if (!(await isFile(filePath))) {
      throw new Error(`找不到${label}：${filePath}`);
    }
  }
  const style = finalVideoStyle(requestedStyle);
  finalVideoStyles.set(record.id, style);
  await fs.mkdir(paths.outputDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${record.id}_最终英文成片.log`);
  const output = createWriteStream(logPath, { flags: "w", encoding: "utf8" });
  const child = spawn(
    punctuationPython,
    finalVideoArguments(paths, style),
    {
      cwd: workflowRootDirectory,
      windowsHide: true,
      env: finalVideoEnvironment(),
    },
  );
  const task = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logPath,
    error: null,
  };
  activeFinalVideoTasks.set(record.id, task);
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on("error", (error) => {
    task.status = "failed";
    task.error = `最终成片启动失败：${error.message}`;
    task.finishedAt = new Date().toISOString();
    output.end(`\n任务状态：failed\n${task.error}\n`);
  });
  child.on("close", (code) => {
    if (task.status !== "failed") {
      task.status = code === 0 ? "completed" : "failed";
      task.error = code === 0 ? null : `最终成片退出码：${code}`;
      task.finishedAt = new Date().toISOString();
    }
    output.end(`\n任务状态：${task.status}\n`);
  });
  return finalVideoStatus(record);
}

async function buildReferenceRecord(sourcePath) {
  const normalizedPath = sourcePath.trim().replace(/^"(.*)"$/, "$1");
  const resolvedPath = await fs.realpath(path.resolve(normalizedPath));
  const extension = path.extname(resolvedPath).toLowerCase();
  if (!videoMimeTypes.has(extension)) {
    throw new Error(`不支持的视频格式：${extension || "未知格式"}`);
  }
  const stats = await fs.stat(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`不是有效的视频文件：${resolvedPath}`);
  }
  const id = crypto.randomUUID();
  return {
    id,
    name: path.basename(resolvedPath),
    sourcePath: resolvedPath,
    workspaceDirectory: projectWorkspaceDirectory(
      resolvedPath,
      id,
      runtimeSettings.projectWorkspaceRoot,
    ),
    size: stats.size,
    type: videoMimeTypes.get(extension),
    createdAt: Date.now(),
  };
}

async function addReferencePaths(paths) {
  const catalog = await loadCatalog();
  const created = [];
  const legacyFilesToDelete = [];
  for (const sourcePath of paths) {
    const incoming = await buildReferenceRecord(sourcePath);
    const existing = catalog.find(
      (record) =>
        record.sourcePath &&
        record.sourcePath.toLocaleLowerCase() === incoming.sourcePath.toLocaleLowerCase(),
    );
    if (existing) {
      created.push(existing);
      continue;
    }
    const legacyCopy = catalog.find(
      (record) =>
        !record.sourcePath &&
        record.fileName &&
        record.name === incoming.name &&
        record.size === incoming.size,
    );
    if (legacyCopy) {
      legacyFilesToDelete.push(path.join(uploadDirectory, legacyCopy.fileName));
      legacyCopy.sourcePath = incoming.sourcePath;
      legacyCopy.workspaceDirectory =
        legacyCopy.workspaceDirectory ||
        projectWorkspaceDirectory(
          incoming.sourcePath,
          legacyCopy.id,
          runtimeSettings.projectWorkspaceRoot,
        );
      legacyCopy.type = incoming.type;
      delete legacyCopy.fileName;
      created.push(legacyCopy);
      continue;
    }
    catalog.push(incoming);
    created.push(incoming);
  }
  if (created.length > 0) {
    await writeCatalog(catalog);
    for (const copiedFile of legacyFilesToDelete) {
      await fs.rm(copiedFile, { force: true });
    }
  }
  return created.map(publicVideo);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

async function requestVideo(request, response) {
  const video = await findVideoById(request.params.id);
  if (!video) {
    response.sendStatus(404);
    return null;
  }
  return video;
}

app.get("/api/videos", async (_request, response, next) => {
  try {
    const videos = await loadCatalog();
    response.json(sortedVideos(videos).map(publicVideo));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id", async (request, response, next) => {
  try {
    const video = await requestVideo(request, response);
    if (!video) {
      return;
    }
    response.json(publicVideo(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/open-path", async (request, response, next) => {
  try {
    const video = await requestVideo(request, response);
    if (!video) {
      return;
    }
    await openProjectPath(video, request.body?.path);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/open-artifact", async (request, response, next) => {
  try {
    const video = await requestVideo(request, response);
    if (!video) {
      return;
    }
    await openProjectArtifact(video, request.body?.artifactKey);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/register", async (request, response, next) => {
  try {
    if (!request.body?.sourcePath || typeof request.body.sourcePath !== "string") {
      response.status(400).json({ error: "缺少原视频路径。" });
      return;
    }
    const [record] = await addReferencePaths([request.body.sourcePath]);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/select-source", async (_request, response, next) => {
  try {
    const sourcePath = await selectVideoPath();
    if (!sourcePath) {
      response.status(204).end();
      return;
    }
    const [record] = await addReferencePaths([sourcePath]);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos/:id", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    if (!video.sourcePath && video.fileName) {
      await fs.rm(path.join(uploadDirectory, video.fileName), { force: true });
    }
    await fs.rm(thumbnailPath(video), { force: true });
    await writeCatalog(videos.filter((item) => item.id !== video.id));
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/bs-roformer", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await bsRoformerStatus(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/bs-roformer/run", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(await startBsRoformer(video));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/ocr-subtitles", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await ocrStatus(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/ocr-subtitles/run", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(await startOcr(video));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/whisperx-speakers", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await whisperxStatus(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/whisperx-speakers/run", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(await startWhisperx(video));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/final-subtitles", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await finalSubtitlesStatus(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/final-subtitles/run", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(await startFinalSubtitles(video));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/subtitle-editor", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await subtitleEditorState(video));
  } catch (error) {
    next(error);
  }
});

app.put("/api/videos/:id/workflow/subtitle-editor", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await saveSubtitleEditor(video, request.body?.cues));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/subtitle-editor/import-srt", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await importTranslatedSubtitleFile(video));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/english-dubbing-mix", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await englishDubbingStatus(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/english-dubbing-mix/run", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(await startEnglishDubbing(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/english-dubbing-mix/redub", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(
      await startSingleEnglishDubbingRedub(video, request.body?.segmentNumber),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/final-video", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await finalVideoStatus(video));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/final-video/preview", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.json(await generateFinalVideoPreview(video, request.body?.style));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/workflow/final-video/run", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.status(202).json(await startFinalVideo(video, request.body?.style));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/workflow/final-video/previews/:frameNumber", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    const paths = finalVideoOutputPaths(video);
    const frameNumber = Number(request.params.frameNumber);
    const previewPath = paths?.previewPaths[frameNumber - 1];
    if (!previewPath || !(await isFile(previewPath))) {
      response.sendStatus(404);
      return;
    }
    response.sendFile(previewPath, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/thumbnail", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.sendFile(await ensureThumbnail(video), {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/content", async (request, response, next) => {
  try {
    const videos = await loadCatalog();
    const video = videos.find((item) => item.id === request.params.id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    const filePath = sourceFilePath(video);
    const stats = await fs.stat(filePath);
    const range = request.headers.range;
    response.setHeader("Content-Type", video.type);
    response.setHeader("Accept-Ranges", "bytes");

    if (!range) {
      response.setHeader("Content-Length", stats.size);
      createReadStream(filePath).pipe(response);
      return;
    }

    const [rawStart, rawEnd] = range.replace("bytes=", "").split("-");
    const start = Number(rawStart);
    const end = rawEnd ? Number(rawEnd) : stats.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end >= stats.size) {
      response.status(416).setHeader("Content-Range", `bytes */${stats.size}`).end();
      return;
    }
    response.status(206);
    response.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
    response.setHeader("Content-Length", end - start + 1);
    createReadStream(filePath, { start, end }).pipe(response);
  } catch (error) {
    next(error);
  }
});

app.use(
  express.static(distDirectory, {
    setHeaders(response) {
      response.setHeader("Cache-Control", "no-store");
    },
  }),
);
app.get("/{*route}", async (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    next();
    return;
  }
  try {
    await fs.access(path.join(distDirectory, "index.html"));
    response.sendFile(path.join(distDirectory, "index.html"), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    response.status(404).send("前端尚未构建。开发模式请访问 Vite 地址。");
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(400).json({ error: error.message || "请求处理失败。" });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`视频翻译工作流服务已启动：http://127.0.0.1:${port}`);
  console.log("新项目仅记录原视频路径，不复制视频文件。");
});
