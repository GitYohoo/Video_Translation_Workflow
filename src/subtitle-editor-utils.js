export function buildTranslationPrompt(chineseSrtPath, geminiJsonPath) {
  if (!chineseSrtPath || !geminiJsonPath) {
    return "";
  }
  return `你是一名专业的影视字幕翻译师和英文配音脚本统筹。请读取以下中文字幕 SRT 文件，将字幕正文翻译成自然、简洁、适合英文配音的英文，并将结果写入指定 JSON 文件。

输入文件：
${chineseSrtPath}

输出文件：
${geminiJsonPath}

要求：
1. 输出文件必须是纯 JSON，不要输出 Markdown、解释、标题或代码块。
2. JSON 必须包含 display_subtitles 和 dubbing_groups 两个数组。
3. display_subtitles 用于画面显示，必须保持输入 SRT 的编号、起止时间、条数和顺序，不得合并、拆分或改动时间轴。
4. display_subtitles 的 text 只翻译字幕正文；若原文包含开头角色标签，例如 [黑猫]，必须保留角色标签，仅翻译其后的台词。
5. dubbing_groups 是后续英文 TTS 的“整句分段建议”，用于把被字幕切碎的同一句话合成一个配音分段。
6. 不要因为同一说话人连续说话就合并多句话；只能合并构成同一个完整句子或同一个不可拆台词单元的相邻字幕。
7. 不得跨说话人合并。说话人变化、完整句结束、语义转折、明显停顿或新动作反应都必须断开。
8. 极短语气词、承接词、半句，例如 Oh, Uh, Um..., Hmph, Thanks.，只有在它属于同一句完整台词时才并入相邻字幕。
9. 每个 dubbing_group 的目标是“一次 TTS 朗读一句完整英文对白”，不是减少段数。
10. dubbing_groups 必须完整覆盖所有 display_subtitles，每条显示字幕只能出现一次。
11. dubbing_groups 的 start 取第一条字幕开始时间，end 取最后一条字幕结束时间；后续会按这个整句时间窗切割原始 DX 对白轨作为参考音色。
12. dubbing_groups 的 text 要适合 TTS 一次性朗读，可在不改变意思的前提下合并标点和轻微润色。
13. 对每个 segment_type 为 tts 的 dubbing_group 必须判断英文配音语速，计算公式为：英文词数 ÷ 可用秒数 × 60 = WPM。
14. 可用秒数是该 dubbing_group 的 end 减去 start；英文词数只统计 text 中实际会朗读的英文单词。
15. WPM 必须控制在 90–190 WPM，优先保持在 90–180 WPM，尽量不超过 180 WPM；只有为了保留准确语义和自然表达确实无法再压缩时，才允许落在 181–190 WPM。
16. 如果 WPM 不在 90–190 范围内，必须修改英文译文：过快时用更简洁自然的表达，过慢时用更完整自然但不增加新事实的表达。修改时必须保留原有语境和意思、人物关系、语气、情绪与关键信息，不得曲解、遗漏或添加剧情。
17. 修改译文后必须重新计算 WPM，持续调整到符合范围；同时保证 dubbing_groups 与对应 display_subtitles 的英文语义一致。每个 tts 类型的 dubbing_group 都要输出取整后的 wpm 数值。
18. segment_type 为 preserve_original 的非语言人声不参与 WPM 计算，其 wpm 写 null。
19. 对“哈哈哈、呵呵、大笑、冷笑、哭声、抽泣、喘息、喘气、尖叫、咳嗽、叹气”等非语言人声，不要翻译成可朗读对白，也不要写成 ha ha ha 给 TTS 朗读；这类条目的 segment_type 必须写 preserve_original。
20. 普通可朗读对白的 segment_type 必须写 tts。若一个 dubbing_group 内包含非语言人声并且没有实质台词，该 group 的 segment_type 必须是 preserve_original；如果非语言人声和实质台词混在一起，必须优先拆成相邻的 tts 与 preserve_original 两个 group。

JSON 格式：
{
  "display_subtitles": [
    {
      "index": 1,
      "start": "00:00:00,000",
      "end": "00:00:03,000",
      "speaker": "角色名或未标注",
      "segment_type": "tts 或 preserve_original",
      "text": "[角色名] English display subtitle text"
    }
  ],
  "dubbing_groups": [
    {
      "group_id": 1,
      "subtitle_indices": [1, 2, 3],
      "start": "00:00:00,000",
      "end": "00:00:05,800",
      "speaker": "角色名或未标注",
      "segment_type": "tts 或 preserve_original",
      "text": "A complete English sentence for one TTS pass.",
      "wpm": 124,
      "merge_reason": "Fragments 1-3 form one complete sentence."
    }
  ]
}`;
}

export function formatTimelineSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remainder}`;
}

function parseSubtitleTimeMs(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(String(value || "").trim());
  if (!match) {
    return null;
  }
  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function formatSubtitleTimeMs(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const milliseconds = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function cueBoundaryMs(cue, boundary) {
  const stored = boundary === "start" ? cue?.startMs : cue?.endMs;
  return Number.isFinite(stored) ? stored : parseSubtitleTimeMs(cue?.[boundary]);
}

export function insertedCueTiming(cues, index) {
  const cue = cues[index] || {};
  const nextCue = cues[index + 1] || null;
  const startMs = cueBoundaryMs(cue, "end") ?? cueBoundaryMs(cue, "start") ?? 0;
  const nextStartMs = nextCue ? cueBoundaryMs(nextCue, "start") : null;
  const endMs = Number.isFinite(nextStartMs) && nextStartMs > startMs
    ? nextStartMs
    : startMs + 100;
  return {
    start: formatSubtitleTimeMs(startMs),
    end: formatSubtitleTimeMs(endMs),
    startMs,
    endMs,
  };
}

export function withRenumberedCues(cues) {
  return cues.map((cue, index) => ({ ...cue, number: index + 1 }));
}

let nextInsertedChineseCueId = 0;

export function withChineseCueEditorMetadata(cues) {
  return cues.map((cue) => ({
    ...cue,
    editorId: `source-${cue.number}`,
    sourceNumber: cue.number,
  }));
}

export function createInsertedChineseCueId() {
  nextInsertedChineseCueId += 1;
  return `inserted-${nextInsertedChineseCueId}`;
}

export function withUpdatedCueTime(cue, field, value) {
  if (field === "start") {
    const startMs = parseSubtitleTimeMs(value);
    return { ...cue, start: value, ...(startMs === null ? {} : { startMs }) };
  }
  if (field === "end") {
    const endMs = parseSubtitleTimeMs(value);
    return { ...cue, end: value, ...(endMs === null ? {} : { endMs }) };
  }
  return { ...cue, [field]: value };
}

export function mergeTimelineRanges(ranges) {
  return [...ranges]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}
