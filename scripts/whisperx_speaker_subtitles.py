from __future__ import annotations

import argparse
import gc
import json
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 WhisperX 生成带说话人标签的中文字幕。")
    parser.add_argument("--audio", required=True, help="输入对白轨文件路径")
    parser.add_argument("--runtime-dir", required=True, help="运行资源目录")
    parser.add_argument("--token-file", required=True, help="Hugging Face 访问令牌文件")
    parser.add_argument("--model", default="large-v3", help="Whisper 模型名称")
    parser.add_argument("--batch-size", default=4, type=int, help="GPU 转写批大小")
    return parser.parse_args()


def configure_cuda_dll_path(runtime_dir: Path) -> None:
    torch_lib = runtime_dir / "whisperx-venv" / "Lib" / "site-packages" / "torch" / "lib"
    if torch_lib.is_dir():
        os.environ["PATH"] = f"{torch_lib}{os.pathsep}{os.environ.get('PATH', '')}"
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(torch_lib))


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def smooth_single_character_speaker_glitches(segments: list[dict]) -> None:
    words = [
        word
        for segment in segments
        for word in segment.get("words", [])
        if "start" in word and "end" in word and word.get("speaker") and word.get("word", "").strip()
    ]
    if not words:
        return

    runs: list[dict] = []
    for word in words:
        if not runs or runs[-1]["speaker"] != word["speaker"]:
            runs.append(
                {
                    "speaker": word["speaker"],
                    "start": word["start"],
                    "end": word["end"],
                    "words": [word],
                }
            )
        else:
            runs[-1]["end"] = word["end"]
            runs[-1]["words"].append(word)

    for index, run in enumerate(runs):
        text = "".join(word["word"].strip() for word in run["words"])
        if len(text) != 1:
            continue
        previous = runs[index - 1] if index > 0 else None
        following = runs[index + 1] if index + 1 < len(runs) else None
        replacement = None
        if previous and following and previous["speaker"] == following["speaker"]:
            replacement = previous["speaker"]
        elif previous and run["start"] - previous["end"] <= 0.15 and (
            following is None or following["start"] - run["end"] > 0.8
        ):
            replacement = previous["speaker"]
        elif following and following["start"] - run["end"] <= 0.15 and (
            previous is None or run["start"] - previous["end"] > 0.8
        ):
            replacement = following["speaker"]
        if replacement:
            for word in run["words"]:
                word["speaker"] = replacement


def normalize_speakers(segments: list[dict]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for segment in segments:
        for word in segment.get("words", []):
            label = word.get("speaker")
            if label is not None and label not in labels:
                labels[label] = f"Speaker {len(labels) + 1}"
    for segment in segments:
        label = segment.get("speaker")
        if label is not None and label not in labels:
            labels[label] = f"Speaker {len(labels) + 1}"
        if label in labels:
            segment["speaker"] = labels[label]
        for word in segment.get("words", []):
            word_label = word.get("speaker")
            if word_label in labels:
                word["speaker"] = labels[word_label]
    return labels


def build_subtitle_cues(segments: list[dict]) -> list[dict]:
    words = [
        word
        for segment in segments
        for word in segment.get("words", [])
        if "start" in word and "end" in word and word.get("word", "").strip()
    ]
    if not words:
        return [
            {
                "start": segment["start"],
                "end": segment["end"],
                "text": segment.get("text", "").strip(),
                "speaker": segment.get("speaker"),
            }
            for segment in segments
        ]

    cues: list[dict] = []
    current: dict | None = None
    for word in words:
        text = word["word"].strip()
        speaker = word.get("speaker", "Speaker ?")
        new_cue = (
            current is None
            or current["speaker"] != speaker
            or word["start"] - current["end"] > 0.8
            or len(current["text"]) + len(text) > 24
        )
        if new_cue:
            if current is not None:
                cues.append(current)
            current = {"start": word["start"], "end": word["end"], "text": text, "speaker": speaker}
        else:
            current["end"] = word["end"]
            current["text"] += text
    if current is not None:
        cues.append(current)
    return cues


def cue_text(segment: dict) -> str:
    text = segment.get("text", "").strip()
    speaker = segment.get("speaker", "Speaker ?")
    return f"{speaker}: {text}"


def write_srt(path: Path, segments: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="\n") as output:
        for index, segment in enumerate(segments, start=1):
            output.write(f"{index}\n")
            output.write(f"{srt_time(segment['start'])} --> {srt_time(segment['end'])}\n")
            output.write(f"{cue_text(segment)}\n\n")


def main() -> int:
    args = parse_args()
    audio_path = Path(args.audio).resolve()
    runtime_dir = Path(args.runtime_dir).resolve()
    token_path = Path(args.token_file).resolve()
    model_dir = runtime_dir / "whisperx-models"
    output_dir = (
        audio_path.parent.parent / "WhisperX_说话人字幕"
        if audio_path.parent.name == "输出音轨"
        else audio_path.parent / f"{audio_path.stem}_WhisperX_说话人字幕"
    )
    model_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not audio_path.is_file():
        raise FileNotFoundError(f"找不到对白轨：{audio_path}")
    if not token_path.is_file():
        raise FileNotFoundError(f"找不到 Hugging Face 令牌：{token_path}")

    configure_cuda_dll_path(runtime_dir)
    import torch
    import whisperx
    from whisperx.diarize import DiarizationPipeline, assign_word_speakers

    if not torch.cuda.is_available():
        raise RuntimeError("WhisperX GPU 环境未识别 CUDA。")

    token = token_path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("Hugging Face 令牌文件为空。")

    device = "cuda"
    print(f"GPU：{torch.cuda.get_device_name(0)}", flush=True)
    print("正在读取对白轨并执行中文转写...", flush=True)
    audio = whisperx.load_audio(str(audio_path))
    model = whisperx.load_model(
        args.model,
        device,
        compute_type="float16",
        language="zh",
        download_root=str(model_dir),
        vad_method="silero",
        use_auth_token=token,
    )
    result = model.transcribe(audio, batch_size=args.batch_size, language="zh")
    del model
    gc.collect()
    torch.cuda.empty_cache()

    print("正在执行逐词时间对齐...", flush=True)
    align_model, metadata = whisperx.load_align_model("zh", device, model_dir=str(model_dir))
    result = whisperx.align(result["segments"], align_model, metadata, audio, device)
    del align_model
    gc.collect()
    torch.cuda.empty_cache()

    print("正在自动区分说话人...", flush=True)
    diarization = DiarizationPipeline(token=token, device=device, cache_dir=str(model_dir))
    diarize_segments = diarization(audio)
    result = assign_word_speakers(diarize_segments, result, fill_nearest=True)
    smooth_single_character_speaker_glitches(result["segments"])
    labels = normalize_speakers(result["segments"])
    subtitle_cues = build_subtitle_cues(result["segments"])
    subtitle_speakers = list(dict.fromkeys(cue["speaker"] for cue in subtitle_cues if cue.get("speaker")))
    result["language"] = "zh"
    result["speaker_map"] = labels
    result["subtitle_cues"] = subtitle_cues

    base_name = f"{audio_path.stem}_Speaker_Diarization"
    srt_path = output_dir / f"{base_name}.srt"
    json_path = output_dir / f"{base_name}.json"
    write_srt(srt_path, subtitle_cues)
    with json_path.open("w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)

    print(f"字幕中使用的说话人数量：{len(subtitle_speakers)}", flush=True)
    print(f"生成字幕条目数量：{len(subtitle_cues)}", flush=True)
    print(f"SRT：{srt_path}", flush=True)
    print(f"结果数据：{json_path}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"处理失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
