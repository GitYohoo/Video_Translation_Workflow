from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SPEAKER_PREFIX = re.compile(r"^(?P<speaker>Speaker\s+\S+)\s*:\s*(?P<text>.*)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="合并 OCR 中文字幕与 WhisperX 候选说话人标签。")
    parser.add_argument("--speaker-srt", required=True, help="WhisperX Speaker_Diarization SRT")
    parser.add_argument("--ocr-srt", required=True, help="OCR 标点修复 SRT")
    parser.add_argument("--output-dir", required=True, help="最终中文字幕输出目录")
    parser.add_argument("--video-stem", required=True, help="原视频文件名（不含扩展名）")
    return parser.parse_args()


def parse_srt_time(value: str) -> float:
    hours, minutes, seconds = value.replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def read_srt(path: Path) -> list[dict]:
    blocks = re.split(r"\r?\n\s*\r?\n", path.read_text(encoding="utf-8-sig").strip())
    cues: list[dict] = []
    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            continue
        start_text, end_text = (piece.strip() for piece in lines[1].split("-->", maxsplit=1))
        cues.append(
            {
                "start": parse_srt_time(start_text),
                "end": parse_srt_time(end_text),
                "text": "\n".join(lines[2:]).strip(),
            }
        )
    return cues


def read_speaker_cues(path: Path) -> list[dict]:
    speaker_cues: list[dict] = []
    for cue in read_srt(path):
        match = SPEAKER_PREFIX.match(cue["text"].replace("\n", " ").strip())
        if match:
            speaker_cues.append({**cue, "speaker": match.group("speaker")})
    return speaker_cues


def attach_speakers(ocr_cues: list[dict], speaker_cues: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for cue in ocr_cues:
        overlap_by_speaker: dict[str, float] = {}
        for speaker_cue in speaker_cues:
            overlap = min(cue["end"], speaker_cue["end"]) - max(cue["start"], speaker_cue["start"])
            if overlap > 0:
                speaker = speaker_cue["speaker"]
                overlap_by_speaker[speaker] = overlap_by_speaker.get(speaker, 0.0) + overlap
        output = dict(cue)
        if overlap_by_speaker:
            output["speaker"] = max(overlap_by_speaker.items(), key=lambda item: item[1])[0]
        merged.append(output)
    return merged


def display_text(cue: dict) -> str:
    if cue.get("speaker"):
        return f"[候选 {cue['speaker']}] {cue['text']}"
    return cue["text"]


def write_srt(path: Path, cues: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="\n") as output:
        for index, cue in enumerate(cues, start=1):
            output.write(f"{index}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n")
            output.write(f"{display_text(cue)}\n\n")


def main() -> int:
    args = parse_args()
    inputs = [
        Path(args.speaker_srt).resolve(),
        Path(args.ocr_srt).resolve(),
    ]
    for input_path in inputs:
        if not input_path.is_file():
            raise FileNotFoundError(f"找不到合并输入字幕：{input_path}")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    ocr_cues = read_srt(inputs[1])
    speaker_cues = read_speaker_cues(inputs[0])
    if not ocr_cues:
        raise RuntimeError("OCR 标点修复 SRT 没有可合并的字幕条目。")
    if not speaker_cues:
        raise RuntimeError("WhisperX SRT 没有可识别的候选说话人条目。")

    merged_cues = attach_speakers(ocr_cues, speaker_cues)
    output_srt = output_dir / f"{args.video_stem}_最终中文字幕.srt"
    write_srt(output_srt, merged_cues)
    labeled_count = sum(1 for cue in merged_cues if cue.get("speaker"))
    print(f"合并字幕条目：{len(merged_cues)}；带候选说话人条目：{labeled_count}", flush=True)
    print(f"最终中文字幕 SRT：{output_srt}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"处理失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
