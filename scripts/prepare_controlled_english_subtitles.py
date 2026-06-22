from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import re


TIME_PATTERN = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
SPEAKER_PATTERN = re.compile(r"^\[(?P<speaker>[^\]]+)\]\s*(?P<text>.*)$", re.DOTALL)
NON_SPEECH_PATTERN = re.compile(
    r"(哈哈+|呵呵+|笑声|大笑|冷笑|嗤笑|偷笑|笑|laughs?|laughter|chuckles?|giggles?|"
    r"哭声|哭泣|抽泣|啜泣|呜咽|crying|sobbing|"
    r"喘息|喘气|气喘|倒吸|breath(?:ing)?|gasps?|"
    r"尖叫|惊叫|screams?|咳嗽|咳|coughs?|叹气|叹息|sighs?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Cue:
    number: int
    start: str
    end: str
    text: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="以最终中文字幕为唯一时间轴，生成受控英文字幕并完成预检。")
    parser.add_argument("--canonical-srt", required=True, help="作为权威时间轴与角色来源的最终中文字幕 SRT")
    parser.add_argument("--translated-srt", required=True, help="人工或模型编辑的英文字幕 SRT，仅读取英文正文")
    parser.add_argument("--output-srt", required=True, help="供配音和成片使用的受控英文字幕 SRT")
    parser.add_argument("--report-json", required=True, help="预检结果 JSON")
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


def load_srt(path: Path) -> list[Cue]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    cues: list[Cue] = []
    cursor = 0
    while cursor < len(lines):
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        if cursor >= len(lines):
            break
        position = len(cues) + 1
        try:
            number = int(lines[cursor].strip())
        except ValueError as error:
            raise ValueError(
                f"SRT 第 {position} 个段落序号无效：{lines[cursor]}"
            ) from error
        cursor += 1
        if cursor >= len(lines):
            raise ValueError(f"SRT 第 {position} 个段落格式错误。")
        match = TIME_PATTERN.search(lines[cursor])
        if not match:
            raise ValueError(f"SRT 第 {number} 段时间格式无效：{lines[cursor]}")
        start = match.group("start").replace(".", ",")
        end = match.group("end").replace(".", ",")
        if parse_time(end) <= parse_time(start):
            raise ValueError(f"SRT 第 {number} 段结束时间必须晚于开始时间。")
        cursor += 1
        text_lines: list[str] = []
        while cursor < len(lines):
            next_line_is_number = lines[cursor].strip().isdigit()
            next_line_is_time = (
                cursor + 1 < len(lines) and TIME_PATTERN.search(lines[cursor + 1])
            )
            if next_line_is_number and next_line_is_time:
                break
            text_lines.append(lines[cursor])
            cursor += 1
        text = "\n".join(text_lines).strip()
        cues.append(Cue(number, start, end, text))
    if not cues:
        raise ValueError(f"SRT 没有字幕条目：{path}")
    return cues


def speaker_and_text(text: str) -> tuple[str | None, str]:
    stripped = text.strip()
    match = SPEAKER_PATTERN.match(stripped)
    if not match:
        return None, stripped
    speaker = match.group("speaker").strip()
    body = match.group("text").strip()
    if not body and NON_SPEECH_PATTERN.search(speaker):
        return None, stripped
    return speaker, body


def validate_canonical(cues: list[Cue]) -> None:
    for index, cue in enumerate(cues, start=1):
        if cue.number != index:
            raise ValueError(f"主时间轴序号不连续：期望第 {index} 段，实际为第 {cue.number} 段。")
    for previous, current in zip(cues, cues[1:]):
        if parse_time(current.start) < parse_time(previous.end):
            raise ValueError(f"主时间轴存在重叠：第 {previous.number} 段与第 {current.number} 段。")


def build_controlled(
    canonical: list[Cue], translated: list[Cue]
) -> tuple[list[Cue], list[int], list[int], list[int]]:
    translated_by_number = {cue.number: cue for cue in translated}
    canonical_numbers = {cue.number for cue in canonical}
    unknown_numbers = sorted(number for number in translated_by_number if number not in canonical_numbers)
    if unknown_numbers:
        raise ValueError(
            f"英文译稿包含主时间轴中不存在的编号：{', '.join(str(number) for number in unknown_numbers)}。"
        )
    timing_corrected: list[int] = []
    role_corrected: list[int] = []
    skipped_numbers: list[int] = []
    controlled: list[Cue] = []
    for master in canonical:
        draft = translated_by_number.get(master.number)
        master_role, _ = speaker_and_text(master.text)
        if draft is None:
            skipped_numbers.append(master.number)
            continue
        draft_role, english_text = speaker_and_text(draft.text)
        if not english_text:
            skipped_numbers.append(master.number)
            continue
        if (draft.start, draft.end) != (master.start, master.end):
            timing_corrected.append(master.number)
        if draft_role != master_role:
            role_corrected.append(master.number)
        controlled_text = f"[{master_role}] {english_text}" if master_role else english_text
        controlled.append(Cue(master.number, master.start, master.end, controlled_text))
    if not controlled:
        raise ValueError("英文译稿没有可用于配音的字幕条目。")
    return controlled, timing_corrected, role_corrected, skipped_numbers


def output_text(cues: list[Cue]) -> str:
    return "".join(
        f"{cue.number}\n{cue.start} --> {cue.end}\n{cue.text}\n\n"
        for cue in cues
    )


def affected_segments(previous: list[Cue], current: list[Cue]) -> list[dict]:
    old = {cue.number: cue for cue in previous}
    changes: list[dict] = []
    for cue in current:
        before = old.get(cue.number)
        reasons: list[str] = []
        if before is None:
            reasons.append("新增")
        else:
            if before.text != cue.text:
                reasons.append("英文文本或角色变化")
            if (before.start, before.end) != (cue.start, cue.end):
                reasons.append("时间窗变化")
        if reasons:
            changes.append({"编号": cue.number, "原因": reasons})
    return changes


def main() -> int:
    args = parse_args()
    canonical_path = Path(args.canonical_srt).resolve()
    translated_path = Path(args.translated_srt).resolve()
    output_path = Path(args.output_srt).resolve()
    report_path = Path(args.report_json).resolve()
    for label, path in (("最终中文字幕", canonical_path), ("英文译稿", translated_path)):
        if not path.is_file():
            raise FileNotFoundError(f"找不到{label}：{path}")

    canonical = load_srt(canonical_path)
    translated = load_srt(translated_path)
    validate_canonical(canonical)
    controlled, timing_corrected, role_corrected, skipped_numbers = build_controlled(canonical, translated)
    previous = load_srt(output_path) if output_path.is_file() else []
    changes = affected_segments(previous, controlled)
    content = output_text(controlled)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not output_path.is_file() or output_path.read_text(encoding="utf-8-sig") != content:
        output_path.write_text(content, encoding="utf-8-sig", newline="\n")
    report = {
        "状态": "通过",
        "主时间轴": str(canonical_path),
        "英文译稿": str(translated_path),
        "受控英文字幕": str(output_path),
        "条目数量": len(controlled),
        "纠正时间码数量": len(timing_corrected),
        "纠正时间码编号": timing_corrected,
        "纠正角色标签数量": len(role_corrected),
        "纠正角色标签编号": role_corrected,
        "跳过编号": skipped_numbers,
        "跳过数量": len(skipped_numbers),
        "受影响片段数量": len(changes),
        "受影响片段": changes,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"英文字幕预检通过：{len(controlled)} 条可配音字幕；跳过 {len(skipped_numbers)} 条。受控时间轴：{output_path}", flush=True)
    print(f"已纠正时间码：{len(timing_corrected)} 条；已统一角色标签：{len(role_corrected)} 条。", flush=True)
    print(f"相对上次受控字幕需更新片段：{len(changes)} 条；报告：{report_path}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"处理失败：{error}", flush=True)
        raise SystemExit(1)
