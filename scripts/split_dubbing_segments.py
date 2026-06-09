from __future__ import annotations

import argparse
import csv
import html
import re
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path


TIME_PATTERN = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
SPEAKER_PATTERN = re.compile(r"^\[(?P<speaker>[^\]]+)\]\s*(?P<line>.*)$", re.DOTALL)
INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
NON_SPEECH_PATTERN = re.compile(
    r"(哈哈+|呵呵+|大笑|笑声|冷笑|哭声|哭泣|抽泣|喘息|喘气|尖叫|咳嗽|叹气|"
    r"\b(laughs?|laughter|chuckles?|giggles?|crying|sobbing|breath(?:ing)?|gasps?|"
    r"screams?|coughs?|sighs?)\b)",
    re.IGNORECASE,
)
PRESERVE_ORIGINAL = "preserve_original"
TTS_SEGMENT = "tts"


@dataclass(frozen=True)
class Cue:
    number: int
    source_numbers: str
    start_ms: int
    end_ms: int
    text: str
    speaker: str
    dialogue: str
    segment_type: str = TTS_SEGMENT
    preserve_original: bool = False
    merge_reason: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按英文 SRT 或整句配音分段时间轴切割 DX 对白轨，生成分段配音素材。")
    parser.add_argument("--subtitle", help="英文翻译 SRT 文件路径")
    parser.add_argument("--dubbing-plan", help="英文配音整句分段 CSV；传入后按整句时间窗切割")
    parser.add_argument("--audio", required=True, help="DX 对白轨 WAV 文件路径")
    parser.add_argument("--preserve-audio", help="可选：非语言人声保留层来源，通常传入原视频路径")
    parser.add_argument("--output-dir", required=True, help="英文配音分段输出目录")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="源音轨变化时，替换本脚本生成的全部片段和清单",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="字幕变化时保留相同时间窗片段，仅补充新增片段并更新清单",
    )
    return parser.parse_args()


def parse_srt_time(value: str) -> int:
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


def filename_time(milliseconds: int) -> str:
    return srt_time(milliseconds).replace(":", "").replace(",", "")


def split_speaker(text: str) -> tuple[str, str]:
    stripped = text.strip()
    match = SPEAKER_PATTERN.match(stripped)
    if not match:
        return "未标注", stripped
    speaker = match.group("speaker").strip()
    dialogue = match.group("line").strip()
    if not dialogue and NON_SPEECH_PATTERN.search(speaker):
        return "未标注", stripped
    return speaker or "未标注", dialogue


def load_cues(subtitle_path: Path) -> list[Cue]:
    subtitle_text = subtitle_path.read_text(encoding="utf-8-sig")
    blocks = re.split(r"\r?\n\s*\r?\n", subtitle_text.strip())
    cues: list[Cue] = []
    for position, block in enumerate(blocks, start=1):
        lines = block.splitlines()
        if len(lines) < 3:
            raise ValueError(f"SRT 第 {position} 个段落格式错误：缺少序号、时间或文本。")
        try:
            number = int(lines[0].strip())
        except ValueError as error:
            raise ValueError(f"SRT 第 {position} 个段落序号无效：{lines[0]}") from error
        match = TIME_PATTERN.search(lines[1])
        if not match:
            raise ValueError(f"SRT 第 {number} 段时间格式无效：{lines[1]}")
        start_ms = parse_srt_time(match.group("start"))
        end_ms = parse_srt_time(match.group("end"))
        if end_ms <= start_ms:
            raise ValueError(f"SRT 第 {number} 段结束时间必须晚于开始时间。")
        text = "\n".join(line.strip() for line in lines[2:]).strip()
        if not text:
            raise ValueError(f"SRT 第 {number} 段没有配音文本。")
        speaker, dialogue = split_speaker(text)
        cues.append(Cue(number, str(number), start_ms, end_ms, text, speaker, dialogue))
    if not cues:
        raise ValueError("SRT 中没有可切割的字幕段落。")
    for previous, current in zip(cues, cues[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError(
                f"SRT 时间顺序错误：第 {current.number} 段早于第 {previous.number} 段开始。"
            )
    return cues


def load_dubbing_plan(plan_path: Path) -> list[Cue]:
    cues: list[Cue] = []
    with plan_path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            number = int(row["编号"])
            start_ms = parse_srt_time(row["开始时间"])
            end_ms = parse_srt_time(row["结束时间"])
            if end_ms <= start_ms:
                raise ValueError(f"配音整句分段第 {number} 段结束时间必须晚于开始时间。")
            dialogue = row["英文台词"].strip()
            if not dialogue:
                raise ValueError(f"配音整句分段第 {number} 段没有英文台词。")
            speaker = row.get("说话人", "未标注").strip() or "未标注"
            source_numbers = row.get("原字幕编号", str(number)).strip() or str(number)
            segment_type = row.get("段类型", TTS_SEGMENT).strip() or TTS_SEGMENT
            if segment_type not in {TTS_SEGMENT, PRESERVE_ORIGINAL}:
                segment_type = TTS_SEGMENT
            preserve_value = row.get("保留原声", "").strip().lower()
            preserve_original = segment_type == PRESERVE_ORIGINAL or preserve_value in {"1", "true", "yes", "y", "是"}
            merge_reason = row.get("合并原因", "").strip()
            cues.append(
                Cue(
                    number,
                    source_numbers,
                    start_ms,
                    end_ms,
                    f"[{speaker}] {dialogue}" if speaker != "未标注" else dialogue,
                    speaker,
                    dialogue,
                    segment_type,
                    preserve_original,
                    merge_reason,
                )
            )
    if not cues:
        raise ValueError("配音整句分段 CSV 中没有可切割的段落。")
    for previous, current in zip(cues, cues[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError(f"配音整句分段时间顺序错误：第 {current.number} 段早于第 {previous.number} 段。")
    return cues


def safe_name(value: str) -> str:
    safe = INVALID_FILENAME_CHARS.sub("_", value.strip())
    safe = re.sub(r"\s+", "_", safe).strip("._")
    return safe or "未标注"


def prepare_output(output_dir: Path, overwrite: bool, update: bool) -> Path:
    clips_dir = output_dir / "片段"
    preserve_dir = output_dir / "保留原声片段"
    generated_paths = [
        clips_dir,
        preserve_dir,
        output_dir / "英文配音分段清单.csv",
        output_dir / "英文配音分段清单.html",
    ]
    existing_paths = [path for path in generated_paths if path.exists()]
    if existing_paths and not overwrite and not update:
        raise FileExistsError(
            f"输出中已有分段文件：{existing_paths[0]}。需要覆盖时请传入 --overwrite。"
        )
    if overwrite and clips_dir.exists():
        shutil.rmtree(clips_dir)
    if overwrite and preserve_dir.exists():
        shutil.rmtree(preserve_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)
    preserve_dir.mkdir(parents=True, exist_ok=True)
    return clips_dir


def milliseconds_to_frame(milliseconds: int, frame_rate: int) -> int:
    return (milliseconds * frame_rate + 500) // 1000


def clip_filename(cue: Cue) -> str:
    return (
        f"{cue.number:03d}_{filename_time(cue.start_ms)}-{filename_time(cue.end_ms)}_"
        f"{safe_name(cue.speaker)}.wav"
    )


def preserve_filename(cue: Cue) -> str:
    return (
        f"{cue.number:03d}_{filename_time(cue.start_ms)}-{filename_time(cue.end_ms)}_"
        f"{safe_name(cue.speaker)}_原声.wav"
    )


def cut_audio(audio_path: Path, cues: list[Cue], clips_dir: Path) -> tuple[wave._wave_params, list[str]]:
    filenames: list[str] = []
    with wave.open(str(audio_path), "rb") as source:
        params = source.getparams()
        if params.comptype != "NONE":
            raise ValueError(f"仅支持未压缩 PCM WAV，对白轨压缩类型为：{params.comptype}")
        total_frames = params.nframes
        for cue in cues:
            start_frame = milliseconds_to_frame(cue.start_ms, params.framerate)
            end_frame = milliseconds_to_frame(cue.end_ms, params.framerate)
            if end_frame > total_frames:
                raise ValueError(
                    f"SRT 第 {cue.number} 段结束于 {srt_time(cue.end_ms)}，超出音频时长。"
                )
            filename = clip_filename(cue)
            output_path = clips_dir / filename
            if output_path.is_file():
                filenames.append(filename)
                continue
            source.setpos(start_frame)
            frames = source.readframes(end_frame - start_frame)
            with wave.open(str(output_path), "wb") as target:
                target.setparams(params)
                target.writeframes(frames)
            filenames.append(filename)
    return params, filenames


def cut_preserve_audio(source_path: Path, cues: list[Cue], output_dir: Path) -> list[str]:
    preserve_dir = output_dir / "保留原声片段"
    filenames: list[str] = []
    preserve_cues = [cue for cue in cues if cue.preserve_original]
    if not preserve_cues:
        return ["" for _ in cues]
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法切割非语言人声保留层。")
    by_number: dict[int, str] = {}
    for cue in preserve_cues:
        filename = preserve_filename(cue)
        target = preserve_dir / filename
        if not target.is_file():
            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    f"{cue.start_ms / 1000:.3f}",
                    "-i",
                    str(source_path),
                    "-t",
                    f"{(cue.end_ms - cue.start_ms) / 1000:.3f}",
                    "-vn",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-c:a",
                    "pcm_s16le",
                    str(target),
                ],
                check=True,
            )
        by_number[cue.number] = f"保留原声片段/{filename}"
    for cue in cues:
        filenames.append(by_number.get(cue.number, ""))
    return filenames


def write_csv(output_path: Path, cues: list[Cue], filenames: list[str], preserve_filenames: list[str]) -> None:
    with output_path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output)
        writer.writerow([
            "编号",
            "原字幕编号",
            "开始时间",
            "结束时间",
            "时长秒",
            "说话人",
            "段类型",
            "保留原声",
            "音频文件",
            "保留原声文件",
            "英文台词",
            "合并原因",
        ])
        for cue, filename, preserve_filename_ in zip(cues, filenames, preserve_filenames):
            writer.writerow(
                [
                    cue.number,
                    cue.source_numbers,
                    srt_time(cue.start_ms),
                    srt_time(cue.end_ms),
                    f"{(cue.end_ms - cue.start_ms) / 1000:.3f}",
                    cue.speaker,
                    cue.segment_type,
                    "yes" if cue.preserve_original else "no",
                    f"片段/{filename}",
                    preserve_filename_,
                    cue.dialogue,
                    cue.merge_reason,
                ]
            )


def write_html(
    output_path: Path,
    subtitle_path: Path,
    audio_path: Path,
    cues: list[Cue],
    filenames: list[str],
    params: wave._wave_params,
) -> None:
    rows: list[str] = []
    for cue, filename in zip(cues, filenames):
        rows.append(
            "<tr>"
            f"<td>{cue.number:03d}</td>"
            f"<td>{html.escape(cue.source_numbers)}</td>"
            f"<td>{html.escape(cue.speaker)}</td>"
            f"<td>{html.escape(cue.segment_type)}</td>"
            f"<td>{'yes' if cue.preserve_original else 'no'}</td>"
            f"<td>{srt_time(cue.start_ms)} - {srt_time(cue.end_ms)}</td>"
            f"<td>{(cue.end_ms - cue.start_ms) / 1000:.3f}s</td>"
            f"<td>{html.escape(cue.dialogue)}</td>"
            f"<td>{html.escape(cue.merge_reason)}</td>"
            f'<td><audio controls preload="none" src="片段/{html.escape(filename)}"></audio></td>'
            "</tr>"
        )
    page = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>英文配音分段清单</title>
  <style>
    body {{ max-width: 1400px; margin: 28px auto; padding: 0 22px; font-family: "Microsoft YaHei", Arial, sans-serif; color: #111827; line-height: 1.55; }}
    h1 {{ margin-bottom: 10px; }}
    .meta {{ padding: 14px 18px; border-left: 4px solid #2563eb; background: #eff6ff; margin: 18px 0 24px; }}
    .meta p {{ margin: 5px 0; }}
    code {{ font-family: Consolas, monospace; word-break: break-all; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
    th, td {{ border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }}
    th {{ position: sticky; top: 0; background: #f3f4f6; text-align: left; }}
    td:nth-child(1), td:nth-child(3), td:nth-child(4) {{ white-space: nowrap; }}
    td:nth-child(5) {{ min-width: 300px; }}
    audio {{ height: 32px; width: 260px; }}
  </style>
</head>
<body>
  <h1>英文配音分段清单</h1>
  <div class="meta">
    <p>片段数量：<strong>{len(cues)}</strong></p>
    <p>字幕：<code>{html.escape(str(subtitle_path))}</code></p>
    <p>对白轨：<code>{html.escape(str(audio_path))}</code></p>
    <p>音频格式：{params.framerate} Hz / {params.nchannels} 声道 / {params.sampwidth * 8} bit PCM；片段严格采用配音清单起止时间。<code>preserve_original</code> 段会跳过 TTS，并在配音清单中指向保留原声片段。</p>
  </div>
  <table>
    <thead>
      <tr><th>编号</th><th>原字幕编号</th><th>说话人</th><th>段类型</th><th>保留原声</th><th>时间段</th><th>时长</th><th>英文台词</th><th>合并原因</th><th>原对白试听</th></tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</body>
</html>
"""
    output_path.write_text(page, encoding="utf-8", newline="\n")


def main() -> int:
    args = parse_args()
    subtitle_path = Path(args.subtitle).resolve() if args.subtitle else None
    audio_path = Path(args.audio).resolve()
    preserve_audio_path = Path(args.preserve_audio).resolve() if args.preserve_audio else audio_path
    output_dir = Path(args.output_dir).resolve()
    plan_path = Path(args.dubbing_plan).resolve() if args.dubbing_plan else None
    if not subtitle_path and not plan_path:
        raise ValueError("必须传入 --subtitle 或 --dubbing-plan。")
    if subtitle_path and not subtitle_path.is_file():
        raise FileNotFoundError(f"找不到英文字幕：{subtitle_path}")
    if plan_path and not plan_path.is_file():
        raise FileNotFoundError(f"找不到英文配音整句分段清单：{plan_path}")
    if not audio_path.is_file():
        raise FileNotFoundError(f"找不到 DX 对白轨：{audio_path}")
    if not preserve_audio_path.is_file():
        raise FileNotFoundError(f"找不到非语言人声保留层来源：{preserve_audio_path}")
    if args.overwrite and args.update:
        raise ValueError("--overwrite 与 --update 不能同时使用。")

    cues = load_dubbing_plan(plan_path) if plan_path else load_cues(subtitle_path)
    clips_dir = prepare_output(output_dir, args.overwrite, args.update)
    params, filenames = cut_audio(audio_path, cues, clips_dir)
    preserve_filenames = cut_preserve_audio(preserve_audio_path, cues, output_dir)
    write_csv(output_dir / "英文配音分段清单.csv", cues, filenames, preserve_filenames)
    write_html(
        output_dir / "英文配音分段清单.html",
        plan_path or subtitle_path,
        audio_path,
        cues,
        filenames,
        params,
    )

    print(f"英文配音分段完成：{len(cues)} 个片段", flush=True)
    print(f"片段目录：{clips_dir}", flush=True)
    print(f"清单文件：{output_dir / '英文配音分段清单.html'}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"处理失败：{error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
