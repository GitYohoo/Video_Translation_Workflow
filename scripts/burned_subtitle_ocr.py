from __future__ import annotations

import argparse
from difflib import SequenceMatcher
from html import escape
import json
import re
import sys
import time
from pathlib import Path

import cv2
from paddleocr import PaddleOCR


OCR_PROFILES = {
    "quality": ("PP-OCRv6_medium_det", "PP-OCRv6_medium_rec"),
    "fast": ("PP-OCRv6_small_det", "PP-OCRv6_small_rec"),
    "quality-v5": ("PP-OCRv5_server_det", "PP-OCRv5_server_rec"),
    "fast-v5": ("PP-OCRv5_mobile_det", "PP-OCRv5_mobile_rec"),
}
CHAR_NORMALIZATION = str.maketrans(
    {
        "別": "别",
        "丟": "丢",
        "決": "决",
        "跡": "迹",
        "沒": "没",
        "註": "注",
    }
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="从视频画面烧录字幕提取可校对的字幕时间轴。")
    parser.add_argument("--video", required=True, help="输入视频路径")
    parser.add_argument("--runtime-dir", required=True, help="项目运行目录")
    parser.add_argument("--output-dir", help="可选输出目录；默认使用视频名命名的 OCR 字幕校准目录")
    parser.add_argument("--speaker-json", help="WhisperX 候选说话人结果 JSON")
    parser.add_argument("--sample-fps", type=float, default=5.0, help="画面采样帧率")
    parser.add_argument("--reuse-report", help="复用既有 OCR 字幕数据 JSON，仅重建输出文件")
    parser.add_argument("--ocr-profile", choices=OCR_PROFILES, default="quality", help="OCR 质量档")
    parser.add_argument("--batch-size", type=int, default=24, help="一次送入 GPU 的采样帧数量")
    parser.add_argument("--corrections-json", help="可选的系列词典 JSON，格式为 {\"误识别\": \"正确文本\"}")
    parser.add_argument("--crop-top", type=float, help="字幕裁切区域顶部比例，范围 0 至 1")
    parser.add_argument("--crop-bottom", type=float, help="字幕裁切区域底部比例，范围 0 至 1")
    return parser.parse_args()


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def load_corrections(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    with path.open("r", encoding="utf-8-sig") as source:
        corrections = json.load(source)
    if not isinstance(corrections, dict) or not all(
        isinstance(source, str) and isinstance(target, str)
        for source, target in corrections.items()
    ):
        raise ValueError("词典 JSON 必须为字符串到字符串的映射。")
    return corrections


def clean_text(value: str, corrections: dict[str, str] | None = None) -> str:
    text = "".join(value.strip().split()).translate(CHAR_NORMALIZATION).lstrip("·•")
    if re.search(r"[\u4e00-\u9fff]", text):
        text = text.replace("(", "（").replace(")", "）")
    for source, replacement in (corrections or {}).items():
        text = text.replace(source, replacement)
    return text


def comparable_text(value: str, corrections: dict[str, str] | None = None) -> str:
    return clean_text(value, corrections).replace("，", "").replace("。", "").replace("？", "").replace("！", "")


def subtitle_crop_range(width: int, height: int, crop_top: float | None, crop_bottom: float | None) -> tuple[float, float]:
    if (crop_top is None) != (crop_bottom is None):
        raise ValueError("必须同时指定 --crop-top 与 --crop-bottom。")
    if crop_top is not None and crop_bottom is not None:
        if not 0 <= crop_top < crop_bottom <= 1:
            raise ValueError("字幕裁切比例必须满足 0 <= crop-top < crop-bottom <= 1。")
        return crop_top, crop_bottom
    if height > width:
        return 0.60, 0.82
    return 0.84, 0.98


def subtitle_crop(frame, crop_top: float, crop_bottom: float):
    height, width = frame.shape[:2]
    return frame[int(height * crop_top) : int(height * crop_bottom), 0:width]


def recognize_result(result, corrections: dict[str, str]) -> tuple[str, float]:
    boxes_with_text: list[dict] = []
    data = result.json["res"]
    texts = data.get("rec_texts", [])
    scores = data.get("rec_scores", [])
    boxes = data.get("rec_boxes", [])
    for text, score, box in zip(texts, scores, boxes):
        text = clean_text(text, corrections)
        if text and float(score) >= 0.70:
            boxes_with_text.append(
                {
                    "x": int(box[0]),
                    "y": int(box[1]),
                    "height": max(1, int(box[3]) - int(box[1])),
                    "text": text,
                    "score": float(score),
                }
            )
    if not boxes_with_text:
        return "", 0.0
    boxes_with_text.sort(key=lambda item: item["y"])
    rows: list[list[dict]] = []
    for item in boxes_with_text:
        if rows and abs(item["y"] - rows[-1][0]["y"]) <= max(12, item["height"] // 2):
            rows[-1].append(item)
        else:
            rows.append([item])
    ordered: list[dict] = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda item: item["x"]))
    return (
        "".join(item["text"] for item in ordered),
        sum(item["score"] for item in ordered) / len(ordered),
    )


def append_cue(cues: list[dict], text: str, start: float, end: float, confidence: list[float]) -> None:
    if not text or end <= start:
        return
    cue = {
        "start": round(start, 3),
        "end": round(end, 3),
        "text": text,
        "confidence": round(sum(confidence) / max(len(confidence), 1), 4),
    }
    if cues and cues[-1]["text"] == text and cue["start"] - cues[-1]["end"] <= 0.45:
        cues[-1]["end"] = cue["end"]
        cues[-1]["confidence"] = round((cues[-1]["confidence"] + cue["confidence"]) / 2, 4)
    else:
        cues.append(cue)


def related_text(left: str, right: str, corrections: dict[str, str]) -> bool:
    left_text = comparable_text(left, corrections)
    right_text = comparable_text(right, corrections)
    one_character_variant = (
        len(left_text) == len(right_text)
        and len(left_text) >= 4
        and sum(left_char != right_char for left_char, right_char in zip(left_text, right_text)) == 1
    )
    return (
        right_text in left_text
        or left_text in right_text
        or one_character_variant
        or SequenceMatcher(None, left_text, right_text).ratio() >= 0.82
    )


def merge_variant_group(group: list[dict]) -> dict:
    best = max(
        group,
        key=lambda cue: ((cue["end"] - cue["start"]) * cue["confidence"], len(cue["text"])),
    )
    output = dict(best)
    output["start"] = group[0]["start"]
    output["end"] = group[-1]["end"]
    output["confidence"] = round(max(cue["confidence"] for cue in group), 4)
    if len(group) > 1:
        output["ocr_variants"] = [cue["text"] for cue in group]
    return output


def postprocess_cues(cues: list[dict], corrections: dict[str, str]) -> list[dict]:
    normalized: list[dict] = []
    for cue in cues:
        cue = dict(cue)
        cue["text"] = clean_text(cue["text"], corrections)
        text = cue["text"]
        if len(text) == 1 and text.isascii() and cue["confidence"] < 0.9:
            continue
        normalized.append(cue)
    cleaned: list[dict] = []
    group: list[dict] = []
    for cue in normalized:
        if not group:
            group = [cue]
            continue
        previous = group[-1]
        close = cue["start"] - previous["end"] <= 0.45
        if close and related_text(previous["text"], cue["text"], corrections):
            group.append(cue)
        else:
            cleaned.append(merge_variant_group(group))
            group = [cue]
    if group:
        cleaned.append(merge_variant_group(group))
    return cleaned


def consume_observation(
    cues: list[dict],
    observations: list[dict],
    state: dict,
    timestamp: float,
    text: str,
    score: float,
) -> None:
    observations.append({"time": round(timestamp, 3), "text": text, "confidence": round(score, 4)})
    if text == state["active_text"]:
        if text:
            state["active_scores"].append(score)
        return
    append_cue(cues, state["active_text"], state["active_start"], timestamp, state["active_scores"])
    state["active_text"] = text
    state["active_start"] = timestamp
    state["active_scores"] = [score] if text else []


def refine_cue_boundaries(
    capture,
    ocr,
    cues: list[dict],
    corrections: dict[str, str],
    crop_top: float,
    crop_bottom: float,
    video_fps: float,
    frame_count: int,
    sample_interval: int,
    batch_size: int,
) -> tuple[list[dict], dict]:
    if not cues or sample_interval <= 1:
        return cues, {
            "boundary_refine_fps": round(video_fps, 3),
            "boundary_refined_cues": 0,
            "max_start_advance_ms": 0,
        }

    frame_ranges: list[tuple[range, range]] = []
    requested_frames: set[int] = set()
    for cue in cues:
        start_frame = min(frame_count - 1, max(0, round(cue["start"] * video_fps)))
        end_frame = min(frame_count - 1, max(0, round(cue["end"] * video_fps)))
        start_range = range(max(0, start_frame - sample_interval), start_frame + 1)
        end_range = range(max(0, end_frame - sample_interval), end_frame + 1)
        frame_ranges.append((start_range, end_range))
        requested_frames.update(start_range)
        requested_frames.update(end_range)

    detections: dict[int, str] = {}
    sampled_frames: list = []
    sampled_indices: list[int] = []

    def consume_batch() -> None:
        for frame_index, result in zip(sampled_indices, ocr.predict(sampled_frames)):
            detections[frame_index] = recognize_result(result, corrections)[0]
        sampled_frames.clear()
        sampled_indices.clear()

    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
    for frame_index in range(frame_count):
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index not in requested_frames:
            continue
        sampled_frames.append(subtitle_crop(frame, crop_top, crop_bottom))
        sampled_indices.append(frame_index)
        if len(sampled_frames) >= batch_size:
            consume_batch()
    if sampled_frames:
        consume_batch()

    refined: list[dict] = []
    start_advances_ms: list[int] = []
    for cue, (start_range, end_range) in zip(cues, frame_ranges):
        output = dict(cue)
        matching_starts = [
            frame_index
            for frame_index in start_range
            if detections.get(frame_index)
            and related_text(detections[frame_index], cue["text"], corrections)
        ]
        matching_ends = [
            frame_index
            for frame_index in end_range
            if detections.get(frame_index)
            and related_text(detections[frame_index], cue["text"], corrections)
        ]
        if matching_starts:
            refined_start = round(matching_starts[0] / video_fps, 3)
            start_advances_ms.append(round((cue["start"] - refined_start) * 1000))
            output["start"] = refined_start
        if matching_ends:
            output["end"] = round(min(frame_count / video_fps, (matching_ends[-1] + 1) / video_fps), 3)
        if output["end"] <= output["start"]:
            output = dict(cue)
        refined.append(output)

    for previous, current in zip(refined, refined[1:]):
        if previous["end"] > current["start"]:
            previous["end"] = current["start"]

    return refined, {
        "boundary_refine_fps": round(video_fps, 3),
        "boundary_refined_cues": len(refined),
        "max_start_advance_ms": max(start_advances_ms, default=0),
    }


def scan_video(
    video_path: Path,
    sample_fps: float,
    ocr_profile: str,
    batch_size: int,
    corrections: dict[str, str],
    crop_top: float | None,
    crop_bottom: float | None,
) -> tuple[list[dict], list[dict], dict]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")
    video_fps = capture.get(cv2.CAP_PROP_FPS)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / video_fps
    frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    active_crop_top, active_crop_bottom = subtitle_crop_range(
        frame_width, frame_height, crop_top, crop_bottom
    )
    sample_interval = max(1, round(video_fps / sample_fps))
    actual_sample_fps = video_fps / sample_interval
    detection_model, recognition_model = OCR_PROFILES[ocr_profile]
    ocr = PaddleOCR(
        text_detection_model_name=detection_model,
        text_recognition_model_name=recognition_model,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="gpu:0",
        text_recognition_batch_size=batch_size,
    )
    cues: list[dict] = []
    observations: list[dict] = []
    state = {"active_text": "", "active_start": 0.0, "active_scores": []}
    sampled_frames: list = []
    sampled_times: list[float] = []
    frame_index = 0
    start_time = time.perf_counter()
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % sample_interval == 0:
            sampled_frames.append(subtitle_crop(frame, active_crop_top, active_crop_bottom))
            sampled_times.append(frame_index / video_fps)
        frame_index += 1
        if len(sampled_frames) >= batch_size:
            for timestamp, result in zip(sampled_times, ocr.predict(sampled_frames)):
                text, score = recognize_result(result, corrections)
                consume_observation(cues, observations, state, timestamp, text, score)
            print(f"OCR 进度：{sampled_times[-1]:.0f}/{duration:.0f} 秒", flush=True)
            sampled_frames.clear()
            sampled_times.clear()
    if sampled_frames:
        for timestamp, result in zip(sampled_times, ocr.predict(sampled_frames)):
            text, score = recognize_result(result, corrections)
            consume_observation(cues, observations, state, timestamp, text, score)
    append_cue(cues, state["active_text"], state["active_start"], duration, state["active_scores"])
    cues = postprocess_cues(cues, corrections)
    cues, refine_metrics = refine_cue_boundaries(
        capture,
        ocr,
        cues,
        corrections,
        active_crop_top,
        active_crop_bottom,
        video_fps,
        frame_count,
        sample_interval,
        batch_size,
    )
    capture.release()
    elapsed = time.perf_counter() - start_time
    metrics = {
        "ocr_profile": ocr_profile,
        "detection_model": detection_model,
        "recognition_model": recognition_model,
        "batch_size": batch_size,
        "sample_fps": round(actual_sample_fps, 3),
        "sample_count": len(observations),
        "duration_seconds": round(duration, 3),
        "frame_size": f"{frame_width}x{frame_height}",
        "crop_top": active_crop_top,
        "crop_bottom": active_crop_bottom,
        "elapsed_seconds": round(elapsed, 3),
        "speed_x_realtime": round(duration / max(elapsed, 0.001), 3),
        **refine_metrics,
    }
    return cues, observations, metrics


def load_speaker_candidates(path: Path | None) -> list[dict]:
    if path is None or not path.is_file():
        return []
    with path.open("r", encoding="utf-8-sig") as source:
        result = json.load(source)
    return result.get("subtitle_cues", [])


def attach_candidate_speakers(cues: list[dict], candidates: list[dict]) -> list[dict]:
    labeled: list[dict] = []
    for cue in cues:
        overlaps: dict[str, float] = {}
        for candidate in candidates:
            overlap = min(cue["end"], candidate["end"]) - max(cue["start"], candidate["start"])
            if overlap > 0 and candidate.get("speaker"):
                speaker = candidate["speaker"]
                overlaps[speaker] = overlaps.get(speaker, 0.0) + overlap
        output = dict(cue)
        if overlaps:
            speaker, overlap = max(overlaps.items(), key=lambda pair: pair[1])
            output["candidate_speaker"] = speaker
            output["speaker_overlap_ratio"] = round(overlap / max(cue["end"] - cue["start"], 0.001), 3)
        labeled.append(output)
    return labeled


def write_srt(path: Path, cues: list[dict], with_speaker: bool) -> None:
    with path.open("w", encoding="utf-8-sig", newline="\n") as output:
        for index, cue in enumerate(cues, start=1):
            text = cue["text"]
            if with_speaker and cue.get("candidate_speaker"):
                text = f"[候选 {cue['candidate_speaker']}] {text}"
            output.write(f"{index}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{text}\n\n")


def write_quality_report(path: Path, cues: list[dict], metrics: dict, corrections_path: Path | None) -> None:
    low_confidence = [cue for cue in cues if cue["confidence"] < 0.90]
    disputed = [cue for cue in cues if cue.get("ocr_variants")]
    rows: list[str] = []
    for cue in low_confidence + [cue for cue in disputed if cue not in low_confidence]:
        note = "低置信度" if cue in low_confidence else ""
        if cue.get("ocr_variants"):
            note = (note + "；" if note else "") + "多帧变体：" + " / ".join(cue["ocr_variants"])
        rows.append(
            "<tr>"
            f"<td>{escape(srt_time(cue['start']))}</td>"
            f"<td>{escape(cue['text'])}</td>"
            f"<td>{cue['confidence']:.4f}</td>"
            f"<td>{escape(note)}</td>"
            "</tr>"
        )
    metrics_rows = "".join(
        f"<tr><th>{escape(str(key))}</th><td>{escape(str(value))}</td></tr>"
        for key, value in metrics.items()
    )
    corrections_text = escape(str(corrections_path)) if corrections_path else "未使用"
    table_body = "".join(rows) or "<tr><td colspan=\"4\">未发现低置信度或多帧变体条目。</td></tr>"
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>OCR 字幕质量报告</title>
  <style>
    body {{ max-width: 1040px; margin: 28px auto; padding: 0 18px; font-family: "Microsoft YaHei", sans-serif; color: #1f2937; }}
    h1, h2 {{ color: #111827; }}
    table {{ width: 100%; border-collapse: collapse; margin: 12px 0 24px; }}
    th, td {{ border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; vertical-align: top; }}
    th {{ background: #f3f4f6; }}
    .note {{ padding: 10px 14px; border-left: 4px solid #2563eb; background: #eff6ff; }}
  </style>
</head>
<body>
  <h1>OCR 字幕质量报告</h1>
  <p class="note">本报告由工作流自动生成。字幕正文以画面 OCR 为来源；自动 Speaker 候选不构成角色定稿。</p>
  <h2>运行信息</h2>
  <table>{metrics_rows}<tr><th>corrections_json</th><td>{corrections_text}</td></tr></table>
  <h2>需关注条目</h2>
  <p>低置信度条目：{len(low_confidence)}；发生多帧变体条目：{len(disputed)}。</p>
  <table><tr><th>时间</th><th>采用文本</th><th>置信度</th><th>原因</th></tr>{table_body}</table>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")


def main() -> int:
    args = parse_args()
    video_path = Path(args.video).resolve()
    speaker_path = Path(args.speaker_json).resolve() if args.speaker_json else None
    corrections_path = Path(args.corrections_json).resolve() if args.corrections_json else None
    if not video_path.is_file():
        raise FileNotFoundError(f"找不到视频：{video_path}")

    output_dir = (
        Path(args.output_dir).resolve()
        if args.output_dir
        else video_path.parent / f"{video_path.stem}_OCR_字幕校准"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    corrections = load_corrections(corrections_path)
    if args.reuse_report:
        reuse_path = Path(args.reuse_report).resolve()
        with reuse_path.open("r", encoding="utf-8-sig") as source:
            reuse_data = json.load(source)
        cues = postprocess_cues(reuse_data["cues"], corrections)
        observations = reuse_data.get("observations", [])
        metrics = reuse_data.get("metrics", {})
        print(f"正在复用 OCR 数据重建输出：{reuse_path}", flush=True)
    else:
        print("正在从画面底部区域读取烧录字幕...", flush=True)
        cues, observations, metrics = scan_video(
            video_path,
            args.sample_fps,
            args.ocr_profile,
            args.batch_size,
            corrections,
            args.crop_top,
            args.crop_bottom,
        )
    candidates = load_speaker_candidates(speaker_path)
    labeled_cues = attach_candidate_speakers(cues, candidates)

    raw_srt = output_dir / f"{video_path.stem}_OCR_原文.srt"
    candidate_srt = output_dir / f"{video_path.stem}_OCR_候选说话人.srt"
    report_json = output_dir / f"{video_path.stem}_OCR_字幕数据.json"
    quality_report = output_dir / f"{video_path.stem}_OCR_质量报告.html"
    write_srt(raw_srt, labeled_cues, with_speaker=False)
    write_srt(candidate_srt, labeled_cues, with_speaker=True)
    with report_json.open("w", encoding="utf-8") as output:
        json.dump(
            {
                "cues": labeled_cues,
                "observations": observations,
                "metrics": metrics,
                "corrections_json": str(corrections_path) if corrections_path else None,
            },
            output,
            ensure_ascii=False,
            indent=2,
        )
    write_quality_report(quality_report, labeled_cues, metrics, corrections_path)

    labeled_count = sum(1 for cue in labeled_cues if cue.get("candidate_speaker"))
    print(f"OCR 字幕条目：{len(cues)}；具有候选 Speaker 的条目：{labeled_count}", flush=True)
    print(f"原文 SRT：{raw_srt}", flush=True)
    print(f"候选说话人 SRT：{candidate_srt}", flush=True)
    print(f"字幕数据：{report_json}", flush=True)
    print(f"质量报告：{quality_report}", flush=True)
    if metrics.get("elapsed_seconds"):
        print(
            f"OCR 性能：{metrics['elapsed_seconds']} 秒；约 {metrics['speed_x_realtime']}x 实时速度；"
            f"批次 {metrics['batch_size']}；档位 {metrics['ocr_profile']}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"处理失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
