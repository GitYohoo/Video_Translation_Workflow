from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path


PUNCTUATION = set("，。！？；：、,.!?;:…—“”‘’（）()《》【】[]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 FunASR 对 OCR 中文字幕恢复标点。")
    parser.add_argument("--ocr-json", required=True, help="OCR 字幕数据 JSON")
    return parser.parse_args()


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def comparable_text(text: str) -> str:
    return "".join(char for char in text if char not in PUNCTUATION and not char.isspace())


def make_blocks(cues: list[dict]) -> list[list[int]]:
    blocks: list[list[int]] = []
    current: list[int] = []
    current_chars = 0
    for index, cue in enumerate(cues):
        split = False
        if current:
            previous = cues[current[-1]]
            split = cue["start"] - previous["end"] > 1.4 or current_chars + len(cue["text"]) > 160
        if split:
            blocks.append(current)
            current = []
            current_chars = 0
        current.append(index)
        current_chars += len(cue["text"])
    if current:
        blocks.append(current)
    return blocks


def distribute_punctuation(cues: list[dict], indices: list[int], punctuated_text: str) -> bool:
    source_text = "".join(cues[index]["text"] for index in indices)
    if comparable_text(punctuated_text) != comparable_text(source_text):
        return False
    char_to_index: list[int] = []
    for index in indices:
        char_to_index.extend([index] * len(comparable_text(cues[index]["text"])))
        cues[index]["text"] = ""

    source_offset = -1
    pending_prefix = ""
    for char in punctuated_text.replace(" ", ""):
        if char in PUNCTUATION:
            if source_offset >= 0:
                cues[char_to_index[source_offset]]["text"] += char
            else:
                pending_prefix += char
            continue
        source_offset += 1
        target = char_to_index[source_offset]
        if pending_prefix:
            cues[target]["text"] += pending_prefix
            pending_prefix = ""
        cues[target]["text"] += char
    return True


def clean_punctuation_text(text: str) -> str:
    return text.replace("DNA,", "DNA，").replace(").", ")。")


def punctuate_cues(cues: list[dict]) -> tuple[list[dict], list[dict]]:
    import torch
    from funasr import AutoModel

    if not torch.cuda.is_available():
        raise RuntimeError("标点恢复环境未识别 CUDA。")
    model = AutoModel(model="ct-punc", hub="ms", device="cuda:0", disable_update=True)
    punctuated = copy.deepcopy(cues)
    reports: list[dict] = []
    for indices in make_blocks(punctuated):
        source_text = "".join(punctuated[index]["text"] for index in indices)
        result = model.generate(input=source_text)
        restored_text = result[0]["text"] if result else source_text
        accepted = distribute_punctuation(punctuated, indices, restored_text)
        reports.append({"source": source_text, "punctuated": restored_text, "accepted": accepted})
    for cue in punctuated:
        cue["text"] = clean_punctuation_text(cue["text"])
    return punctuated, reports


def write_srt(path: Path, cues: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="\n") as output:
        for index, cue in enumerate(cues, start=1):
            output.write(
                f"{index}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{cue['text']}\n\n"
            )


def main() -> int:
    args = parse_args()
    ocr_json = Path(args.ocr_json).resolve()
    with ocr_json.open("r", encoding="utf-8-sig") as source:
        data = json.load(source)
    cues = data["cues"]
    punctuated_cues, reports = punctuate_cues(cues)
    output_dir = ocr_json.parent
    video_stem = re.sub(r"_OCR_字幕数据$", "", ocr_json.stem)

    srt_path = output_dir / f"{video_stem}_OCR_标点修复.srt"
    json_path = output_dir / f"{video_stem}_OCR_标点修复数据.json"
    write_srt(srt_path, punctuated_cues)
    with json_path.open("w", encoding="utf-8") as output:
        json.dump(
            {
                "cues": punctuated_cues,
                "blocks": reports,
            },
            output,
            ensure_ascii=False,
            indent=2,
        )

    rejected = sum(1 for report in reports if not report["accepted"])
    print(f"标点处理字幕条目：{len(punctuated_cues)}；文本块：{len(reports)}；拒绝改写块：{rejected}", flush=True)
    print(f"标点修复 SRT：{srt_path}", flush=True)
    print(f"标点诊断 JSON：{json_path}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"处理失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
