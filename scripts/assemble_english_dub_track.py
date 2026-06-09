from __future__ import annotations

import argparse
import csv
import html
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DubbingSegment:
    number: int
    start: str
    end: str
    start_ms: int
    end_ms: int
    role: str
    text: str
    fitted_audio: Path
    preserve_audio: Path | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按字幕时间轴合成英文整轨对白，并可与背景底轨混音。")
    parser.add_argument("--manifest", required=True, help="英文配音清单 CSV")
    parser.add_argument("--output-dir", required=True, help="整轨音频输出目录")
    parser.add_argument("--timeline-reference", help="用于确定整轨总长度的原视频音轨或背景底轨 WAV")
    parser.add_argument("--background", help="可选的 MX+FX 无对白背景底轨 WAV")
    parser.add_argument("--output-prefix", default="英文配音", help="输出文件名前缀")
    parser.add_argument("--dialogue-gain", type=float, default=1.0, help="混音中的英文对白增益")
    parser.add_argument("--background-gain", type=float, default=1.0, help="混音中的背景底轨增益")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已存在的整轨输出")
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


def frames_at(milliseconds: int, frame_rate: int) -> int:
    return (milliseconds * frame_rate + 500) // 1000


def format_time(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def load_segments(manifest: Path) -> list[DubbingSegment]:
    segments: list[DubbingSegment] = []
    with manifest.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            start_ms = parse_time(row["开始时间"])
            end_ms = parse_time(row["结束时间"])
            fitted_audio = (manifest.parent / row["时长适配片段"]).resolve()
            if not fitted_audio.is_file():
                raise FileNotFoundError(f"找不到第 {row['编号']} 段时长适配配音：{fitted_audio}")
            preserve_value = row.get("保留原声片段", "").strip()
            preserve_audio = Path(preserve_value).resolve() if preserve_value else None
            if preserve_audio and not preserve_audio.is_file():
                preserve_audio = (manifest.parent / preserve_value).resolve()
            if preserve_audio and not preserve_audio.is_file():
                raise FileNotFoundError(f"找不到第 {row['编号']} 段保留原声片段：{preserve_audio}")
            segments.append(
                DubbingSegment(
                    number=int(row["编号"]),
                    start=row["开始时间"],
                    end=row["结束时间"],
                    start_ms=start_ms,
                    end_ms=end_ms,
                    role=row["角色"],
                    text=row["英文台词"],
                    fitted_audio=fitted_audio,
                    preserve_audio=preserve_audio,
                )
            )
    if not segments:
        raise ValueError("英文配音清单中没有片段。")
    segments.sort(key=lambda segment: (segment.start_ms, segment.number))
    for previous, current in zip(segments, segments[1:]):
        if current.start_ms < previous.end_ms:
            raise ValueError(
                f"字幕时间窗存在重叠：第 {previous.number} 段到 {previous.end}，"
                f"第 {current.number} 段从 {current.start} 开始。"
            )
    return segments


def audio_params(path: Path) -> tuple[wave._wave_params, int]:
    with wave.open(str(path), "rb") as source:
        params = source.getparams()
        return params, source.getnframes()


def validate_pcm(params: wave._wave_params, path: Path) -> None:
    if params.comptype != "NONE" or params.sampwidth != 2:
        raise ValueError(f"仅支持 16 bit 未压缩 PCM WAV：{path}")


def required_outputs(output_dir: Path, prefix: str, has_background: bool) -> list[Path]:
    outputs = [
        output_dir / f"{prefix}_英文对白整轨.wav",
        output_dir / "英文整轨合成清单.csv",
        output_dir / "英文整轨合成结果.html",
    ]
    if has_background:
        outputs.append(output_dir / f"{prefix}_英文成片混音_MX+FX.wav")
    return outputs


def ensure_output_available(paths: list[Path], overwrite: bool) -> None:
    existing = [path for path in paths if path.exists()]
    if existing and not overwrite:
        raise FileExistsError(f"已有整轨输出：{existing[0]}。需要替换时请传入 --overwrite。")


def assemble_dialogue_track(
    segments: list[DubbingSegment],
    output_path: Path,
    timeline_reference: Path | None,
) -> tuple[wave._wave_params, int]:
    first_params, _ = audio_params(segments[0].fitted_audio)
    validate_pcm(first_params, segments[0].fitted_audio)
    last_frame = frames_at(segments[-1].end_ms, first_params.framerate)
    total_frames = last_frame
    if timeline_reference:
        reference_params, reference_frames = audio_params(timeline_reference)
        validate_pcm(reference_params, timeline_reference)
        if (
            reference_params.framerate != first_params.framerate
            or reference_params.nchannels != first_params.nchannels
            or reference_params.sampwidth != first_params.sampwidth
        ):
            raise ValueError("时间轴参考音轨与配音片段的音频格式不一致。")
        if reference_frames < last_frame:
            raise ValueError(
                f"时间轴参考音轨短于最后一段字幕：参考音轨 {reference_frames / first_params.framerate:.3f}s，"
                f"最后字幕结束 {segments[-1].end_ms / 1000:.3f}s。"
            )
        total_frames = reference_frames

    silent_frame = b"\x00" * first_params.sampwidth * first_params.nchannels
    current_frame = 0
    with wave.open(str(output_path), "wb") as output:
        output.setparams(first_params)
        for segment in segments:
            params, segment_frames = audio_params(segment.fitted_audio)
            validate_pcm(params, segment.fitted_audio)
            if (
                params.framerate != first_params.framerate
                or params.nchannels != first_params.nchannels
                or params.sampwidth != first_params.sampwidth
            ):
                raise ValueError(f"第 {segment.number} 段音频格式与整轨不一致：{segment.fitted_audio}")
            start_frame = frames_at(segment.start_ms, first_params.framerate)
            end_frame = frames_at(segment.end_ms, first_params.framerate)
            expected_frames = end_frame - start_frame
            if abs(segment_frames - expected_frames) > 1:
                raise ValueError(
                    f"第 {segment.number} 段时长不符合字幕时间窗："
                    f"音频 {segment_frames / first_params.framerate:.6f}s，"
                    f"时间窗 {(segment.end_ms - segment.start_ms) / 1000:.6f}s。"
                )
            if start_frame < current_frame:
                raise ValueError(f"第 {segment.number} 段与上一段重叠，不能顺序铺轨。")
            if start_frame > current_frame:
                output.writeframes(silent_frame * (start_frame - current_frame))
            with wave.open(str(segment.fitted_audio), "rb") as source:
                output.writeframes(source.readframes(segment_frames))
            if segment_frames < expected_frames:
                output.writeframes(silent_frame * (expected_frames - segment_frames))
            current_frame = end_frame
        if total_frames > current_frame:
            output.writeframes(silent_frame * (total_frames - current_frame))
    return first_params, total_frames


def assemble_preserve_track(
    segments: list[DubbingSegment],
    output_path: Path,
    params: wave._wave_params,
    total_frames: int,
) -> bool:
    preserve_segments = [segment for segment in segments if segment.preserve_audio]
    if not preserve_segments:
        return False
    silent_frame = b"\x00" * params.sampwidth * params.nchannels
    current_frame = 0
    with wave.open(str(output_path), "wb") as output:
        output.setparams(params)
        for segment in preserve_segments:
            preserve_audio = segment.preserve_audio
            if preserve_audio is None:
                continue
            preserve_params, segment_frames = audio_params(preserve_audio)
            validate_pcm(preserve_params, preserve_audio)
            if (
                preserve_params.framerate != params.framerate
                or preserve_params.nchannels != params.nchannels
                or preserve_params.sampwidth != params.sampwidth
            ):
                raise ValueError(f"第 {segment.number} 段保留原声格式与整轨不一致：{preserve_audio}")
            start_frame = frames_at(segment.start_ms, params.framerate)
            end_frame = frames_at(segment.end_ms, params.framerate)
            expected_frames = end_frame - start_frame
            if start_frame < current_frame:
                raise ValueError(f"第 {segment.number} 段保留原声与上一段重叠，不能顺序铺轨。")
            if start_frame > current_frame:
                output.writeframes(silent_frame * (start_frame - current_frame))
            frames_to_read = min(segment_frames, expected_frames)
            with wave.open(str(preserve_audio), "rb") as source:
                output.writeframes(source.readframes(frames_to_read))
            if frames_to_read < expected_frames:
                output.writeframes(silent_frame * (expected_frames - frames_to_read))
            current_frame = end_frame
        if total_frames > current_frame:
            output.writeframes(silent_frame * (total_frames - current_frame))
    return True


def mix_dialogue_layers(
    voice_path: Path,
    preserve_path: Path,
    output_path: Path,
    preserve_gain: float = 0.75,
) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法叠加非语言人声保留层。")
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(voice_path),
            "-i",
            str(preserve_path),
            "-filter_complex",
            (
                f"[1:a]volume={preserve_gain:.6f}[keep];"
                "[0:a][keep]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
                "alimiter=limit=0.98[out]"
            ),
            "-map",
            "[out]",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ],
        check=True,
    )


def mix_background(
    dialogue_path: Path,
    background_path: Path,
    output_path: Path,
    dialogue_gain: float,
    background_gain: float,
) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法生成背景混音成片音轨。")
    if dialogue_gain < 0 or background_gain < 0:
        raise ValueError("混音增益不能小于 0。")
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(background_path),
            "-i",
            str(dialogue_path),
            "-filter_complex",
            (
                f"[0:a]volume={background_gain:.6f}[bg];"
                f"[1:a]volume={dialogue_gain:.6f}[voice];"
                "[bg][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
                "alimiter=limit=0.98[out]"
            ),
            "-map",
            "[out]",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ],
        check=True,
    )


def write_csv(output_path: Path, segments: list[DubbingSegment]) -> None:
    with output_path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["编号", "开始时间", "结束时间", "时长秒", "角色", "英文台词", "时长适配片段", "保留原声片段"])
        for segment in segments:
            writer.writerow(
                [
                    segment.number,
                    segment.start,
                    segment.end,
                    f"{(segment.end_ms - segment.start_ms) / 1000:.3f}",
                    segment.role,
                    segment.text,
                    str(segment.fitted_audio),
                    str(segment.preserve_audio) if segment.preserve_audio else "",
                ]
            )


def write_html(
    output_path: Path,
    manifest: Path,
    dialogue_path: Path,
    mixed_path: Path | None,
    background_path: Path | None,
    segments: list[DubbingSegment],
    total_frames: int,
    params: wave._wave_params,
    dialogue_gain: float,
    background_gain: float,
) -> None:
    duration = total_frames / params.framerate
    mix_section = ""
    if mixed_path and background_path:
        mix_section = (
            "<h2>带背景混音</h2>"
            f"<p>背景底轨：<code>{html.escape(str(background_path))}</code>；"
            f"背景增益 <code>{background_gain:.2f}</code>，对白增益 <code>{dialogue_gain:.2f}</code>。</p>"
            f'<audio controls preload="metadata" src="{html.escape(mixed_path.name)}"></audio>'
        )
    rows = "".join(
        "<tr>"
        f"<td>{segment.number:03d}</td>"
        f"<td>{html.escape(segment.start)} - {html.escape(segment.end)}</td>"
        f"<td>{html.escape(segment.role)}</td>"
        f"<td>{html.escape(segment.text)}</td>"
        f"<td>{'yes' if segment.preserve_audio else 'no'}</td>"
        "</tr>"
        for segment in segments
    )
    page = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>英文整轨合成结果</title>
  <style>
    body {{ max-width: 1300px; margin: 28px auto; padding: 0 22px; font-family: "Microsoft YaHei", Arial, sans-serif; color: #111827; line-height: 1.55; }}
    .note {{ background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 18px 0; }}
    code {{ font-family: Consolas, monospace; word-break: break-all; }}
    audio {{ width: min(720px, 100%); }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 14px; }}
    th, td {{ border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }}
    th {{ background: #f3f4f6; position: sticky; top: 0; text-align: left; }}
    td:nth-child(1), td:nth-child(2), td:nth-child(3) {{ white-space: nowrap; }}
  </style>
</head>
<body>
  <h1>英文整轨合成结果</h1>
  <div class="note">
    <p>配音清单：<code>{html.escape(str(manifest))}</code></p>
    <p>片段数量：<strong>{len(segments)}</strong>；整轨时长：<strong>{duration:.3f}s</strong>；音频格式：{params.framerate} Hz / {params.nchannels} 声道 / {params.sampwidth * 8} bit PCM。</p>
    <p>每段英文配音严格按照字幕时间窗放置，台词之间的空档保留为静音；带 <code>保留原声片段</code> 的段会按原时间窗额外叠加原声笑声、哭声或喘息。</p>
  </div>
  <h2>英文对白整轨</h2>
  <audio controls preload="metadata" src="{html.escape(dialogue_path.name)}"></audio>
  {mix_section}
  <h2>时间轴明细</h2>
  <table>
    <thead><tr><th>编号</th><th>时间段</th><th>角色</th><th>英文台词</th><th>保留原声</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</body>
</html>
"""
    output_path.write_text(page, encoding="utf-8", newline="\n")


def main() -> int:
    args = parse_args()
    manifest = Path(args.manifest).resolve()
    output_dir = Path(args.output_dir).resolve()
    timeline_reference = Path(args.timeline_reference).resolve() if args.timeline_reference else None
    background = Path(args.background).resolve() if args.background else None
    if not manifest.is_file():
        raise FileNotFoundError(f"找不到英文配音清单：{manifest}")
    for label, path in (("时间轴参考音轨", timeline_reference), ("背景底轨", background)):
        if path and not path.is_file():
            raise FileNotFoundError(f"找不到{label}：{path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    dialogue_path = output_dir / f"{args.output_prefix}_英文对白整轨.wav"
    mixed_path = output_dir / f"{args.output_prefix}_英文成片混音_MX+FX.wav" if background else None
    csv_path = output_dir / "英文整轨合成清单.csv"
    html_path = output_dir / "英文整轨合成结果.html"
    ensure_output_available(
        required_outputs(output_dir, args.output_prefix, background is not None), args.overwrite
    )
    segments = load_segments(manifest)
    has_preserve_overlay = any(segment.preserve_audio for segment in segments)
    voice_path = output_dir / f"{args.output_prefix}_英文对白整轨_仅TTS.wav" if has_preserve_overlay else dialogue_path
    preserve_path = output_dir / f"{args.output_prefix}_非语言人声保留层.wav"
    params, total_frames = assemble_dialogue_track(segments, voice_path, timeline_reference)
    if has_preserve_overlay:
        assemble_preserve_track(segments, preserve_path, params, total_frames)
        mix_dialogue_layers(voice_path, preserve_path, dialogue_path)
    print(f"英文对白整轨已生成：{dialogue_path}", flush=True)
    if background and mixed_path:
        mix_background(
            dialogue_path,
            background,
            mixed_path,
            args.dialogue_gain,
            args.background_gain,
        )
        print(f"英文背景混音已生成：{mixed_path}", flush=True)
    write_csv(csv_path, segments)
    write_html(
        html_path,
        manifest,
        dialogue_path,
        mixed_path,
        background,
        segments,
        total_frames,
        params,
        args.dialogue_gain,
        args.background_gain,
    )
    print(f"时间轴片段：{len(segments)}；总时长：{total_frames / params.framerate:.3f} 秒", flush=True)
    print(f"试听报告：{html_path}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"处理失败：{error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
