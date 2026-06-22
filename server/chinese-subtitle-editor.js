import fs from "node:fs/promises";

const timePattern = /^(?<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(?<end>\d{2}:\d{2}:\d{2}[,.]\d{3})$/;
const speakerPattern = /^\[(?<speaker>[^\]\r\n]+)\]\s*(?<text>[\s\S]*)$/;

function milliseconds(value) {
  const [hours, minutes, secondsPart] = value.replace(".", ",").split(":");
  const [seconds, fraction] = secondsPart.split(",");
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction);
}

function splitSpeaker(text) {
  const match = speakerPattern.exec(text);
  if (!match) {
    return { speaker: "", text };
  }
  return {
    speaker: match.groups.speaker.trim(),
    text: match.groups.text.trim(),
  };
}

function subtitleBody(cue) {
  if (!cue.speaker) {
    return cue.text;
  }
  return `[${cue.speaker}]${cue.text ? ` ${cue.text}` : ""}`;
}

export function parseChineseSubtitleDocument(content) {
  const blocks = content.replace(/^\uFEFF/, "").trim().split(/\r?\n\s*\r?\n/).filter(Boolean);
  if (blocks.length === 0) {
    throw new Error("最终中文字幕没有字幕条目。");
  }
  const cues = blocks.map((block, index) => {
    const lines = block.split(/\r?\n/);
    const number = Number(lines[0]?.trim());
    const match = timePattern.exec(lines[1]?.trim() || "");
    const parsedText = splitSpeaker(lines.slice(2).join("\n").trim());
    if (!Number.isInteger(number) || number !== index + 1 || !match) {
      throw new Error(`最终中文字幕第 ${index + 1} 段格式无效。`);
    }
    const start = match.groups.start.replace(".", ",");
    const end = match.groups.end.replace(".", ",");
    const startMs = milliseconds(start);
    const endMs = milliseconds(end);
    if (endMs <= startMs) {
      throw new Error(`第 ${number} 条字幕结束时间必须晚于开始时间。`);
    }
    return { number, start, end, startMs, endMs, ...parsedText };
  });
  cues.forEach((cue, index) => {
    if (index > 0 && cue.startMs < cues[index - 1].endMs) {
      throw new Error(`最终中文字幕第 ${cue.number - 1} 与 ${cue.number} 条时间重叠。`);
    }
  });
  return cues;
}

export function serializeChineseSubtitleDocument(cues) {
  return `\uFEFF${cues.map((cue) => `${cue.number}\n${cue.start} --> ${cue.end}\n${subtitleBody(cue)}\n`).join("\n")}`;
}

export async function readChineseSubtitleFile(filePath) {
  const cues = parseChineseSubtitleDocument(await fs.readFile(filePath, "utf8"));
  return { status: "ready", canEdit: true, cues };
}

export async function saveChineseSubtitleFile(filePath, requestedCues) {
  if (!Array.isArray(requestedCues)) {
    throw new Error("缺少字幕编辑内容。");
  }
  const canonical = parseChineseSubtitleDocument(await fs.readFile(filePath, "utf8"));
  if (requestedCues.length !== canonical.length) {
    throw new Error(`字幕条目数量不一致：应为 ${canonical.length} 条。`);
  }
  const requestedByNumber = new Map();
  for (const cue of requestedCues) {
    const text = typeof cue?.text === "string" ? cue.text.trim() : "";
    const speaker = typeof cue?.speaker === "string" ? cue.speaker.trim() : undefined;
    if (!Number.isInteger(cue?.number) || requestedByNumber.has(cue.number)) {
      throw new Error("字幕编号缺失或重复。");
    }
    if (speaker?.includes("[") || speaker?.includes("]") || /[\r\n]/.test(speaker || "")) {
      throw new Error(`第 ${cue.number} 条说话人格式无效。`);
    }
    if ((speaker || "").length > 200) {
      throw new Error(`第 ${cue.number} 条说话人名称过长。`);
    }
    if (text.length > 2000) {
      throw new Error(`第 ${cue.number} 条字幕正文过长。`);
    }
    requestedByNumber.set(cue.number, { speaker, text });
  }
  const updated = canonical.map((cue) => {
    if (!requestedByNumber.has(cue.number)) {
      throw new Error(`缺少第 ${cue.number} 条字幕编辑内容。`);
    }
    const requested = requestedByNumber.get(cue.number);
    return {
      ...cue,
      speaker: requested.speaker === undefined ? cue.speaker : requested.speaker,
      text: requested.text,
    };
  });
  await fs.writeFile(filePath, serializeChineseSubtitleDocument(updated), "utf8");
  return { ...(await readChineseSubtitleFile(filePath)), saved: true };
}
