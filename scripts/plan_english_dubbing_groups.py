from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


TIME_PATTERN = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
SPEAKER_PATTERN = re.compile(r"^\[(?P<speaker>[^\]]+)\]\s*(?P<line>.*)$", re.DOTALL)
NON_SPEECH_PATTERN = re.compile(
    r"(哈哈+|呵呵+|大笑|笑声|冷笑|哭声|哭泣|抽泣|喘息|喘气|尖叫|咳嗽|叹气|"
    r"\b(laughs?|laughter|chuckles?|giggles?|crying|sobbing|breath(?:ing)?|gasps?|"
    r"screams?|coughs?|sighs?|non[-\s]?speech|keep original)\b)",
    re.IGNORECASE,
)
PRESERVE_ORIGINAL = "preserve_original"
TTS_SEGMENT = "tts"


def has_non_speech_marker(text: str) -> bool:
    return bool(NON_SPEECH_PATTERN.search(text or ""))


def strip_non_speech_markers(text: str) -> str:
    cleaned = re.sub(
        r"\[([^\]]*(?:laugh|laughter|chuckle|giggle|cry|sob|breath|gasp|scream|cough|sigh)[^\]]*)\]",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\b(?:laughs?|laughter|chuckles?|giggles?|crying|sobbing|breath(?:ing)?|gasps?|screams?|coughs?|sighs?)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"(哈哈+|呵呵+|大笑|笑声|冷笑|哭声|哭泣|抽泣|喘息|喘气|尖叫|咳嗽|叹气)", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return re.sub(r"\s+([,.!?;:])", r"\1", cleaned)


def segment_type_and_tts_text(text: str, explicit_type: object = "") -> tuple[str, str, bool]:
    raw = str(explicit_type or "").strip().lower().replace("-", "_").replace(" ", "_")
    has_marker = has_non_speech_marker(text)
    tts_text = strip_non_speech_markers(text) if has_marker else text.strip()
    if raw in {
        PRESERVE_ORIGINAL,
        "non_speech",
        "non_speech_vocal",
        "sfx_laugh",
        "laugh",
        "laughter",
        "crying",
        "breathing",
        "scream",
        "sfx",
        "keep_original",
        "original",
    } and not tts_text:
        return PRESERVE_ORIGINAL, text.strip(), True
    if not tts_text and has_marker:
        return PRESERVE_ORIGINAL, text.strip(), True
    return TTS_SEGMENT, tts_text or text.strip(), False


def normalize_segment_type(value: object = "", text: str = "") -> str:
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if raw in {
        PRESERVE_ORIGINAL,
        "non_speech",
        "non_speech_vocal",
        "sfx_laugh",
        "laugh",
        "laughter",
        "crying",
        "breathing",
        "scream",
        "sfx",
        "keep_original",
        "original",
    }:
        return PRESERVE_ORIGINAL
    if raw in {TTS_SEGMENT, "speech", "dialogue", "dialog"}:
        return TTS_SEGMENT
    if has_non_speech_marker(text or "") and not strip_non_speech_markers(text or ""):
        return PRESERVE_ORIGINAL
    return TTS_SEGMENT


@dataclass(frozen=True)
class Cue:
    number: int
    start: str
    end: str
    start_ms: int
    end_ms: int
    speaker: str
    text: str
    segment_type: str = TTS_SEGMENT
    preserve_original: bool = False


@dataclass(frozen=True)
class DubbingGroup:
    group_id: int
    cue_numbers: list[int]
    start: str
    end: str
    start_ms: int
    end_ms: int
    speaker: str
    text: str
    segment_type: str
    preserve_original: bool
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="根据英文显示字幕生成逐段 TTS 配音分段计划。")
    parser.add_argument("--subtitle", help="逐条显示用英文 SRT；不传时从 Gemini JSON 的 display_subtitles 读取")
    parser.add_argument("--gemini-json", help="Gemini 翻译阶段输出的 JSON，需包含 display_subtitles")
    parser.add_argument("--output-subtitle", help="可选：从 Gemini JSON 写出逐条显示用英文 SRT")
    parser.add_argument("--output-csv", required=True, help="输出逐段配音计划 CSV")
    parser.add_argument("--output-json", required=True, help="输出规范化逐段配音计划 JSON")
    parser.add_argument("--output-html", required=True, help="输出逐段配音计划 HTML 报告")
    return parser.parse_args()


def parse_time(value: str) -> int:
    hours, minutes, remainder = value.replace(".", ",").split(":")
    seconds, milliseconds = remainder.split(",")
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1000
        + int(milliseconds)
    )


def srt_time(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def split_speaker(text: str) -> tuple[str, str]:
    stripped = text.strip()
    match = SPEAKER_PATTERN.match(stripped)
    if not match:
        return "未标注", stripped
    speaker = match.group("speaker").strip() or "未标注"
    line = match.group("line").strip()
    if not line and NON_SPEECH_PATTERN.search(speaker):
        return "未标注", stripped
    return speaker, line


def load_srt(path: Path) -> list[Cue]:
    blocks = re.split(r"\r?\n\s*\r?\n", path.read_text(encoding="utf-8-sig").strip())
    cues: list[Cue] = []
    for position, block in enumerate(blocks, start=1):
        lines = block.splitlines()
        if len(lines) < 3:
            raise ValueError(f"SRT 第 {position} 段格式错误。")
        try:
            number = int(lines[0].strip())
        except ValueError as error:
            raise ValueError(f"SRT 第 {position} 段序号无效：{lines[0]}") from error
        match = TIME_PATTERN.search(lines[1])
        if not match:
            raise ValueError(f"SRT 第 {number} 段时间格式错误：{lines[1]}")
        start = match.group("start").replace(".", ",")
        end = match.group("end").replace(".", ",")
        start_ms = parse_time(start)
        end_ms = parse_time(end)
        if end_ms <= start_ms:
            raise ValueError(f"SRT 第 {number} 段结束时间必须晚于开始时间。")
        speaker, text = split_speaker("\n".join(line.strip() for line in lines[2:]).strip())
        if not text:
            raise ValueError(f"SRT 第 {number} 段没有英文正文。")
        segment_type, tts_text, preserve_original = segment_type_and_tts_text(text)
        cues.append(Cue(number, start, end, start_ms, end_ms, speaker, tts_text, segment_type, preserve_original))
    if not cues:
        raise ValueError("英文 SRT 没有字幕条目。")
    for previous, current in zip(cues, cues[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError(f"SRT 时间顺序错误：第 {current.number} 段早于第 {previous.number} 段。")
    return cues


def load_display_subtitles_from_gemini(path: Path) -> list[Cue]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    raw_subtitles = data.get("display_subtitles") if isinstance(data, dict) else None
    if not isinstance(raw_subtitles, list) or not raw_subtitles:
        raise ValueError("Gemini JSON 必须包含非空 display_subtitles 数组，或另行传入 --subtitle。")
    cues: list[Cue] = []
    for position, item in enumerate(raw_subtitles, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"display_subtitles 第 {position} 项必须是对象。")
        number = int(item.get("index", position))
        start = str(item["start"]).replace(".", ",")
        end = str(item["end"]).replace(".", ",")
        start_ms = parse_time(start)
        end_ms = parse_time(end)
        if end_ms <= start_ms:
            raise ValueError(f"display_subtitles 第 {number} 段结束时间必须晚于开始时间。")
        raw_text = str(item.get("text", "")).strip()
        speaker_from_text, text = split_speaker(raw_text)
        explicit_speaker = str(item.get("speaker", "")).strip()
        speaker = explicit_speaker or speaker_from_text
        if speaker == "未标注" and speaker_from_text != "未标注":
            speaker = speaker_from_text
        if not text:
            raise ValueError(f"display_subtitles 第 {number} 段没有英文正文。")
        segment_type, tts_text, preserve_original = segment_type_and_tts_text(
            text,
            item.get("segment_type") or item.get("type"),
        )
        cues.append(Cue(number, start, end, start_ms, end_ms, speaker, tts_text, segment_type, preserve_original))
    for previous, current in zip(cues, cues[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError(f"display_subtitles 时间顺序错误：第 {current.number} 段早于第 {previous.number} 段。")
    return cues


def write_display_srt(path: Path, cues: list[Cue]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for cue in cues:
        text = f"[{cue.speaker}] {cue.text}" if cue.speaker != "未标注" else cue.text
        lines.append(f"{cue.number}\n{cue.start} --> {cue.end}\n{text}\n")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8-sig", newline="\n")


def combined_text(cues: list[Cue]) -> str:
    text = " ".join(cue.text.strip() for cue in cues)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([,.!?;:])", r"\1", text)


def make_group(
    group_id: int,
    cues: list[Cue],
    reason: str,
    text: str | None = None,
    segment_type: str | None = None,
) -> DubbingGroup:
    speakers = {cue.speaker for cue in cues}
    if len(speakers) != 1:
        raise ValueError(f"配音整句分段 {group_id} 跨说话人：{', '.join(sorted(speakers))}")
    current_text = text or combined_text(cues)
    normalized_type, tts_text, preserve_original = segment_type_and_tts_text(
        current_text,
        segment_type or (PRESERVE_ORIGINAL if all(cue.segment_type == PRESERVE_ORIGINAL for cue in cues) else TTS_SEGMENT),
    )
    preserve_original = preserve_original or any(cue.preserve_original for cue in cues)
    return DubbingGroup(
        group_id=group_id,
        cue_numbers=[cue.number for cue in cues],
        start=cues[0].start,
        end=cues[-1].end,
        start_ms=cues[0].start_ms,
        end_ms=cues[-1].end_ms,
        speaker=cues[0].speaker,
        text=tts_text.strip(),
        segment_type=normalized_type,
        preserve_original=preserve_original,
        reason=reason,
    )


def per_cue_groups(cues: list[Cue], reason: str = "逐条分段：每段单独使用原始 DX 对白参考音色") -> list[DubbingGroup]:
    return [
        make_group(index, [cue], reason)
        for index, cue in enumerate(cues, start=1)
    ]


def cue_numbers_from_group(raw_group: dict) -> list[int]:
    if "subtitle_indices" in raw_group:
        values = raw_group["subtitle_indices"]
    elif "subtitle_numbers" in raw_group:
        values = raw_group["subtitle_numbers"]
    elif "source_indices" in raw_group:
        values = raw_group["source_indices"]
    else:
        raise ValueError("Gemini dubbing_groups 条目缺少 subtitle_indices。")
    if isinstance(values, str) and re.fullmatch(r"\d+\s*-\s*\d+", values):
        start, end = [int(part.strip()) for part in values.split("-", 1)]
        return list(range(start, end + 1))
    if not isinstance(values, list) or not values:
        raise ValueError("subtitle_indices 必须是非空数组或形如 12-14 的字符串。")
    return [int(value) for value in values]


def split_by_speaker(cues: list[Cue]) -> list[list[Cue]]:
    chunks: list[list[Cue]] = []
    current: list[Cue] = []
    for cue in cues:
        if current and cue.speaker != current[-1].speaker:
            chunks.append(current)
            current = []
        current.append(cue)
    if current:
        chunks.append(current)
    return chunks


def groups_from_gemini(path: Path, cues: list[Cue]) -> list[DubbingGroup] | None:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    raw_groups = data.get("dubbing_groups") if isinstance(data, dict) else None
    if not raw_groups:
        return None
    if not isinstance(raw_groups, list):
        raise ValueError("Gemini JSON 中的 dubbing_groups 必须是数组。")

    by_number = {cue.number: cue for cue in cues}
    groups: list[DubbingGroup] = []
    used: list[int] = []
    ignored_missing: list[int] = []
    for index, raw_group in enumerate(raw_groups, start=1):
        if not isinstance(raw_group, dict):
            raise ValueError(f"dubbing_groups 第 {index} 项必须是对象。")
        numbers = cue_numbers_from_group(raw_group)
        if numbers != sorted(numbers):
            raise ValueError(f"Gemini 整句分段 {index} 的字幕编号必须按升序填写。")
        if any(current + 1 != nxt for current, nxt in zip(numbers, numbers[1:])):
            raise ValueError(f"Gemini 整句分段 {index} 只能引用连续字幕编号：{numbers}")
        group_cues: list[Cue] = []
        for number in numbers:
            cue = by_number.get(number)
            if cue is None:
                ignored_missing.append(number)
                continue
            group_cues.append(cue)
        if not group_cues:
            continue
        reason = str(raw_group.get("merge_reason") or raw_group.get("segment_reason") or "Gemini 整句分段建议").strip()
        missing_in_group = [number for number in numbers if number not in by_number]
        if missing_in_group:
            reason = f"{reason}；忽略已跳过字幕 {','.join(str(number) for number in missing_in_group)}"
        chunks = split_by_speaker(group_cues)
        if len(chunks) > 1:
            reason = f"{reason}；因说话人变化拆分"
        raw_segment_type = raw_group.get("segment_type") or raw_group.get("type")
        segment_type = (
            normalize_segment_type(raw_segment_type, str(raw_group.get("text", "")))
            if raw_segment_type
            else None
        )
        for chunk in chunks:
            groups.append(make_group(len(groups) + 1, chunk, reason, None, segment_type))
        used.extend(cue.number for cue in group_cues)

    expected = [cue.number for cue in cues]
    if sorted(used) != expected:
        missing = sorted(set(expected) - set(used))
        duplicated = sorted(number for number in set(used) if used.count(number) > 1)
        raise ValueError(f"Gemini 整句分段必须完整且仅覆盖一次可配音字幕。缺失：{missing}；重复：{duplicated}")
    if ignored_missing:
        ignored = ",".join(str(number) for number in sorted(set(ignored_missing)))
        print(f"已忽略 Gemini 分段中不参与配音的跳过字幕：{ignored}", flush=True)
    return groups


def write_csv(path: Path, groups: list[DubbingGroup]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["编号", "原字幕编号", "开始时间", "结束时间", "时长秒", "说话人", "段类型", "保留原声", "英文台词", "合并原因"])
        for group in groups:
            writer.writerow(
                [
                    group.group_id,
                    ",".join(str(number) for number in group.cue_numbers),
                    group.start,
                    group.end,
                    f"{(group.end_ms - group.start_ms) / 1000:.3f}",
                    group.speaker,
                    group.segment_type,
                    "yes" if group.preserve_original else "no",
                    group.text,
                    group.reason,
                ]
            )


def write_json(path: Path, cues: list[Cue], groups: list[DubbingGroup]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "display_subtitles": [
            {
                "index": cue.number,
                "start": cue.start,
                "end": cue.end,
                "speaker": cue.speaker,
                "text": cue.text,
                "segment_type": cue.segment_type,
                "preserve_original": cue.preserve_original,
            }
            for cue in cues
        ],
        "dubbing_groups": [
            {
                "group_id": group.group_id,
                "subtitle_indices": group.cue_numbers,
                "start": group.start,
                "end": group.end,
                "speaker": group.speaker,
                "text": group.text,
                "segment_type": group.segment_type,
                "preserve_original": group.preserve_original,
                "segment_reason": group.reason,
            }
            for group in groups
        ],
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_html(path: Path, subtitle: Path, groups: list[DubbingGroup], source: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = "".join(
        "<tr>"
        f"<td>{group.group_id:03d}</td>"
        f"<td>{html.escape(','.join(str(number) for number in group.cue_numbers))}</td>"
        f"<td>{html.escape(group.start)} - {html.escape(group.end)}</td>"
        f"<td>{(group.end_ms - group.start_ms) / 1000:.3f}s</td>"
        f"<td>{html.escape(group.speaker)}</td>"
        f"<td>{html.escape(group.segment_type)}</td>"
        f"<td>{'yes' if group.preserve_original else 'no'}</td>"
        f"<td>{html.escape(group.text)}</td>"
        f"<td>{html.escape(group.reason)}</td>"
        "</tr>"
        for group in groups
    )
    page = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>英文配音分段计划</title>
  <style>
    body {{ max-width: 1400px; margin: 28px auto; padding: 0 22px; font-family: "Microsoft YaHei", Arial, sans-serif; color: #111827; line-height: 1.55; }}
    .note {{ background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 18px 0; }}
    code {{ font-family: Consolas, monospace; word-break: break-all; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
    th, td {{ border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }}
    th {{ background: #f3f4f6; position: sticky; top: 0; text-align: left; }}
    td:nth-child(1), td:nth-child(2), td:nth-child(3), td:nth-child(4), td:nth-child(5) {{ white-space: nowrap; }}
  </style>
</head>
<body>
  <h1>英文配音分段计划</h1>
  <div class="note">
    <p>显示字幕：<code>{html.escape(str(subtitle))}</code></p>
    <p>规划来源：<strong>{html.escape(source)}</strong></p>
    <p>配音分段：<strong>{len(groups)}</strong> 段。<code>tts</code> 段单独切割原始 DX 对白轨作为参考音色；<code>preserve_original</code> 段跳过 TTS，后续铺回原始非语言人声。</p>
  </div>
  <table>
    <thead><tr><th>分段</th><th>原字幕编号</th><th>时间段</th><th>时长</th><th>角色</th><th>段类型</th><th>保留原声</th><th>配音文本</th><th>原因</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</body>
</html>
"""
    path.write_text(page, encoding="utf-8", newline="\n")


def main() -> int:
    args = parse_args()
    subtitle = Path(args.subtitle).resolve() if args.subtitle else None
    gemini_json = Path(args.gemini_json).resolve() if args.gemini_json else None
    if subtitle and not subtitle.is_file():
        raise FileNotFoundError(f"找不到英文显示字幕：{subtitle}")
    if gemini_json and not gemini_json.is_file():
        raise FileNotFoundError(f"找不到 Gemini 整句分段 JSON：{gemini_json}")
    if subtitle:
        cues = load_srt(subtitle)
    elif gemini_json:
        cues = load_display_subtitles_from_gemini(gemini_json)
        if not args.output_subtitle:
            raise ValueError("未传入 --subtitle 时，必须同时传入 --output-subtitle 以写出显示字幕 SRT。")
        subtitle = Path(args.output_subtitle).resolve()
        write_display_srt(subtitle, cues)
    else:
        raise ValueError("必须传入 --subtitle，或传入包含 display_subtitles 的 --gemini-json。")
    if args.output_subtitle and subtitle and not Path(args.output_subtitle).resolve().is_file():
        write_display_srt(Path(args.output_subtitle).resolve(), cues)
    groups = groups_from_gemini(gemini_json, cues) if gemini_json else None
    if groups:
        source = f"Gemini 整句分段建议：{gemini_json}"
    else:
        groups = per_cue_groups(cues, "无 Gemini 整句建议，退回逐条分段")
        source = "逐条分段兜底规则"
    write_csv(Path(args.output_csv).resolve(), groups)
    write_json(Path(args.output_json).resolve(), cues, groups)
    write_html(Path(args.output_html).resolve(), subtitle, groups, source)
    print(f"英文显示字幕：{len(cues)} 条；配音分段：{len(groups)} 段。", flush=True)
    print(f"分段计划 CSV：{Path(args.output_csv).resolve()}", flush=True)
    print(f"分段计划 HTML：{Path(args.output_html).resolve()}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"处理失败：{error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
