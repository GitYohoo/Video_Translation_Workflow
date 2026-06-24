import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

async function defaultIsFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function parseCsvDocument(content) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0].map((header) => header.trim());
  return {
    headers,
    rows: rows.slice(1).map((values) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = values[index] ?? "";
      });
      return entry;
    }),
  };
}

function csvField(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function serializeCsvDocument(headers, rows) {
  return `\uFEFF${[
    headers.map(csvField).join(","),
    ...rows.map((row) => headers.map((header) => csvField(row[header])).join(",")),
  ].join("\n")}\n`;
}

async function readCsvFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return parseCsvDocument(content);
}

function resolveManifestValue(manifestPath, value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return path.resolve(path.dirname(manifestPath), text);
}

function manifestValueForPath(manifestPath, filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(path.dirname(manifestPath), resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll(path.sep, "/");
  }
  return resolved;
}

function numberFromRow(row) {
  return Number(row["编号"]);
}

function isPreserveOriginal(row) {
  const segmentType = String(row["段类型"] || "").trim();
  const preserve = String(row["保留原声"] || "").trim().toLowerCase();
  return segmentType === "preserve_original" || ["1", "true", "yes", "y", "是"].includes(preserve);
}

function audioUrl(videoId, number, kind) {
  if (!videoId) {
    return null;
  }
  return `/api/videos/${encodeURIComponent(videoId)}/workflow/english-dubbing-mix/segments/${number}/audio?kind=${kind}`;
}

async function audioEntry(filePath, isFile, url) {
  return {
    path: filePath || "",
    ready: filePath ? await isFile(filePath) : false,
    url: filePath ? url : null,
  };
}

export async function readDubbingSegments(paths, videoId = "", options = {}) {
  const isFile = options.isFile || defaultIsFile;
  if (!paths?.segmentManifestPath || !(await isFile(paths.segmentManifestPath))) {
    return [];
  }
  const segmentCsv = await readCsvFile(paths.segmentManifestPath);
  const dubbingCsv =
    paths.dubbingManifestPath && (await isFile(paths.dubbingManifestPath))
      ? await readCsvFile(paths.dubbingManifestPath)
      : { rows: [] };
  const resultsByNumber = new Map(
    dubbingCsv.rows
      .filter((row) => Number.isInteger(numberFromRow(row)))
      .map((row) => [numberFromRow(row), row]),
  );
  const segments = [];
  for (const row of segmentCsv.rows) {
    const number = numberFromRow(row);
    if (!Number.isInteger(number) || number <= 0) {
      continue;
    }
    const result = resultsByNumber.get(number) || {};
    const sourceAudioPath = resolveManifestValue(paths.segmentManifestPath, row["音频文件"]);
    const segmentPreservePath = resolveManifestValue(paths.segmentManifestPath, row["保留原声文件"]);
    const referenceAudioPath = resolveManifestValue(paths.dubbingManifestPath, result["参考音色"]);
    const rawAudioPath = resolveManifestValue(paths.dubbingManifestPath, result["原始合成"]);
    const fittedAudioPath = resolveManifestValue(paths.dubbingManifestPath, result["时长适配片段"]);
    const resultPreservePath = resolveManifestValue(paths.dubbingManifestPath, result["保留原声片段"]);
    segments.push({
      number,
      displayNumber: String(number).padStart(3, "0"),
      sourceNumbers: row["原字幕编号"] || String(number),
      start: row["开始时间"] || "",
      end: row["结束时间"] || "",
      durationSeconds: Number(row["时长秒"]) || null,
      speaker: row["说话人"] || "未标注",
      role: result["角色"] || "",
      segmentType: row["段类型"] || "tts",
      preserveOriginal: isPreserveOriginal(row),
      text: row["英文台词"] || "",
      resultText: result["英文台词"] || "",
      mergeReason: row["合并原因"] || "",
      generationMode: result["生成方式"] || "",
      originalDurationSeconds: result["原始时长秒"] || "",
      speedFactor: result["变速系数"] || "",
      generated: Boolean(result["时长适配片段"]),
      sourceAudio: await audioEntry(sourceAudioPath, isFile, audioUrl(videoId, number, "source")),
      referenceAudio: await audioEntry(referenceAudioPath || sourceAudioPath, isFile, audioUrl(videoId, number, "reference")),
      rawAudio: await audioEntry(rawAudioPath, isFile, audioUrl(videoId, number, "raw")),
      fittedAudio: await audioEntry(fittedAudioPath, isFile, audioUrl(videoId, number, "fitted")),
      preserveAudio: await audioEntry(resultPreservePath || segmentPreservePath, isFile, audioUrl(videoId, number, "preserve")),
    });
  }
  return segments.sort((left, right) => left.number - right.number);
}

function validateSegmentEdit(existingRow, changes) {
  const next = { ...existingRow };
  if (Object.hasOwn(changes, "speaker")) {
    const speaker = String(changes.speaker || "").trim();
    if (!speaker) {
      throw new Error("说话人不能为空。");
    }
    if (/[\r\n]/.test(speaker) || speaker.length > 80) {
      throw new Error("说话人格式无效。");
    }
    next["说话人"] = speaker;
  }
  if (Object.hasOwn(changes, "text")) {
    const text = String(changes.text || "").trim();
    if (!text) {
      throw new Error("英文台词不能为空。");
    }
    if (text.length > 1000) {
      throw new Error("英文台词过长。");
    }
    next["英文台词"] = text;
  }
  if (Object.hasOwn(changes, "segmentType")) {
    const segmentType = String(changes.segmentType || "").trim() || "tts";
    if (!["tts", "preserve_original"].includes(segmentType)) {
      throw new Error("段类型必须是 tts 或 preserve_original。");
    }
    next["段类型"] = segmentType;
    next["保留原声"] = segmentType === "preserve_original" ? "yes" : "no";
  }
  return next;
}

export async function updateDubbingSegmentManifest(paths, segmentNumber, changes = {}, options = {}) {
  const isFile = options.isFile || defaultIsFile;
  const number = Number(segmentNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("配音条目编号无效。");
  }
  if (!paths?.segmentManifestPath || !(await isFile(paths.segmentManifestPath))) {
    throw new Error("找不到英文配音分段清单。");
  }
  const csv = await readCsvFile(paths.segmentManifestPath);
  const index = csv.rows.findIndex((row) => numberFromRow(row) === number);
  if (index < 0) {
    throw new Error(`找不到第 ${String(number).padStart(3, "0")} 条配音。`);
  }
  const updatedRow = validateSegmentEdit(csv.rows[index], changes);
  if (Object.hasOwn(changes, "referenceAudioPath")) {
    const referenceAudioPath = String(changes.referenceAudioPath || "").trim();
    if (!referenceAudioPath) {
      throw new Error("参考音频不能为空。");
    }
    const resolvedReference = path.resolve(referenceAudioPath);
    if (!(await isFile(resolvedReference))) {
      throw new Error(`找不到参考音频：${resolvedReference}`);
    }
    if (path.extname(resolvedReference).toLowerCase() !== ".wav") {
      throw new Error("参考音频必须是 WAV 文件。");
    }
    updatedRow["音频文件"] = manifestValueForPath(paths.segmentManifestPath, resolvedReference);
  }
  csv.rows[index] = updatedRow;
  await fs.writeFile(
    paths.segmentManifestPath,
    serializeCsvDocument(csv.headers, csv.rows),
    "utf8",
  );
  const [segment] = (await readDubbingSegments(paths, options.videoId || "", { isFile })).filter(
    (item) => item.number === number,
  );
  return {
    segment,
  };
}

export async function findDubbingSegmentAudioPath(paths, segmentNumber, kind, options = {}) {
  const isFile = options.isFile || defaultIsFile;
  const segments = await readDubbingSegments(paths, "", { isFile });
  const number = Number(segmentNumber);
  const segment = segments.find((item) => item.number === number);
  if (!segment) {
    throw new Error(`找不到第 ${String(number).padStart(3, "0")} 条配音。`);
  }
  const audioByKind = {
    source: segment.sourceAudio,
    reference: segment.referenceAudio,
    raw: segment.rawAudio,
    fitted: segment.fittedAudio,
    preserve: segment.preserveAudio,
  };
  const audio = audioByKind[kind || "fitted"];
  if (!audio) {
    throw new Error("未知配音音频类型。");
  }
  if (!audio.path || !(await isFile(audio.path))) {
    throw new Error("该配音音频尚未生成。");
  }
  return audio.path;
}

export function streamAudioFile(filePath, response) {
  response.setHeader("Content-Type", "audio/wav");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(filePath).pipe(response);
}

export async function cleanupDubbingSegmentOutputs(paths, segment) {
  const candidates = [
    segment?.rawAudio?.path,
    segment?.fittedAudio?.path,
    segment?.referenceAudio?.path && segment.referenceAudio.path.includes(`${path.sep}参考音色${path.sep}`)
      ? segment.referenceAudio.path
      : "",
    paths?.dialogueTrackPath,
    paths?.mixedTrackPath,
    paths?.assemblyReportPath,
  ].filter(Boolean);
  await Promise.all(
    candidates.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})),
  );
}
