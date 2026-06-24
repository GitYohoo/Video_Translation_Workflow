from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


TIME_PATTERN = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
SPEAKER_PATTERN = re.compile(r"^\[(?P<label>[^\]]+)\]\s*(?P<body>.*)$", re.DOTALL)
NON_SPEECH_PATTERN = re.compile(
    r"(laughs?|laughter|chuckles?|giggles?|crying|sobbing|breath(?:ing)?|gasps?|"
    r"screams?|coughs?|sighs?)",
    re.IGNORECASE,
)
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
VIDEO_RESOLUTION_PATTERN = re.compile(r"\b(?P<width>[1-9]\d{1,4})x(?P<height>[1-9]\d{1,4})\b")


@dataclass(frozen=True)
class SubtitleCue:
    number: int
    start_ms: int
    end_ms: int
    text: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="替换视频音轨，并烧录位于中文字幕上方的英文 ASS 字幕生成英文配音成片。")
    parser.add_argument("--video", required=True, help="原始视频路径")
    parser.add_argument("--audio", help="英文配音与背景混音后的完整音轨")
    parser.add_argument("--subtitle", required=True, help="英文翻译 SRT 路径")
    parser.add_argument("--output-dir", required=True, help="最终视频输出目录")
    parser.add_argument("--output-prefix", default="英文配音成片", help="最终文件名前缀")
    parser.add_argument("--font-name", default="Segoe UI Semibold", help="英文 ASS 字体")
    parser.add_argument("--font-size", type=int, default=50, help="英文 ASS 字号")
    parser.add_argument("--text-color", default="#FFFFFF", help="英文字幕文字颜色，格式为 #RRGGBB")
    parser.add_argument("--background-color", default="#101010", help="英文字幕背景颜色，格式为 #RRGGBB")
    parser.add_argument("--background-opacity", type=float, default=1.0, help="字幕背景不透明度，范围 0 至 1")
    parser.add_argument("--position-x", type=float, default=50.0, help="字幕中心横向位置百分比")
    parser.add_argument("--position-y", type=float, default=84.0, help="字幕中心纵向位置百分比")
    parser.add_argument("--crf", type=int, default=18, help="libx264 CRF 质量参数")
    parser.add_argument("--preset", default="medium", help="libx264 preset")
    parser.add_argument("--preview-only", action="store_true", help="仅生成带字幕样式的参考帧，不编码完整视频")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已有视频、ASS 与报告")
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


def ass_time(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    centiseconds = millis // 10
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def load_srt(path: Path) -> list[SubtitleCue]:
    blocks = re.split(r"\r?\n\s*\r?\n", path.read_text(encoding="utf-8-sig").strip())
    cues: list[SubtitleCue] = []
    for position, block in enumerate(blocks, start=1):
        lines = block.splitlines()
        if len(lines) < 3:
            raise ValueError(f"SRT 第 {position} 段格式错误。")
        number = int(lines[0].strip())
        match = TIME_PATTERN.search(lines[1])
        if not match:
            raise ValueError(f"SRT 第 {number} 段时间格式错误：{lines[1]}")
        start_ms = parse_time(match.group("start"))
        end_ms = parse_time(match.group("end"))
        if end_ms <= start_ms:
            raise ValueError(f"SRT 第 {number} 段结束时间必须晚于开始时间。")
        raw_dialogue = "\n".join(lines[2:]).strip()
        label_match = SPEAKER_PATTERN.match(raw_dialogue)
        if label_match and label_match.group("body").strip():
            dialogue = label_match.group("body").strip()
        elif label_match and NON_SPEECH_PATTERN.search(label_match.group("label")):
            dialogue = raw_dialogue
        else:
            dialogue = raw_dialogue
        if not dialogue:
            raise ValueError(f"SRT 第 {number} 段去除角色标签后没有英文正文。")
        cues.append(SubtitleCue(number, start_ms, end_ms, dialogue))
    if not cues:
        raise ValueError("英文 SRT 中没有字幕条目。")
    for previous, current in zip(cues, cues[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError(f"字幕时间顺序错误：第 {current.number} 段早于第 {previous.number} 段。")
    return cues


def ass_escape(text: str) -> str:
    return (
        text.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
    )


def ass_color(value: str, opacity: float = 1.0) -> str:
    if not HEX_COLOR_PATTERN.fullmatch(value):
        raise ValueError(f"字幕颜色必须为 #RRGGBB 格式：{value}")
    if not 0.0 <= opacity <= 1.0:
        raise ValueError("字幕背景不透明度必须在 0 至 1 之间。")
    red, green, blue = value[1:3], value[3:5], value[5:7]
    alpha = round((1.0 - opacity) * 255)
    return f"&H{alpha:02X}{blue}{green}{red}"


def write_ass(
    path: Path,
    cues: list[SubtitleCue],
    font_name: str,
    font_size: int,
    text_color: str,
    background_color: str,
    background_opacity: float,
    position_x: float,
    position_y: float,
    play_res_width: int = 1920,
    play_res_height: int = 1080,
) -> None:
    if not 0.0 <= position_x <= 100.0 or not 0.0 <= position_y <= 100.0:
        raise ValueError("字幕位置百分比必须在 0 至 100 之间。")
    if play_res_width <= 0 or play_res_height <= 0:
        raise ValueError("ASS 画布分辨率必须大于 0。")
    position_x_pixels = round(play_res_width * position_x / 100)
    position_y_pixels = round(play_res_height * position_y / 100)
    primary_colour = ass_color(text_color)
    back_colour = ass_color(background_color, background_opacity)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_res_width}
PlayResY: {play_res_height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: EnglishAboveChinese,{font_name},{font_size},{primary_colour},{primary_colour},{back_colour},{back_colour},-1,0,0,0,100,100,0.2,0,3,2.4,0,5,100,100,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with path.open("w", encoding="utf-8-sig", newline="\n") as output:
        output.write(header)
        for cue in cues:
            output.write(
                "Dialogue: 0,"
                f"{ass_time(cue.start_ms)},{ass_time(cue.end_ms)},"
                "EnglishAboveChinese,,0,0,0,,"
                rf"{{\an5\pos({position_x_pixels},{position_y_pixels})}}"
                f"{ass_escape(cue.text)}\n"
            )


def probe_video_resolution(video: Path, ffmpeg: str, ffprobe: str | None = None) -> tuple[int, int]:
    if ffprobe:
        try:
            result = subprocess.run(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height",
                    "-of",
                    "json",
                    str(video),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            streams = json.loads(result.stdout or "{}").get("streams") or []
            if streams:
                width = int(streams[0].get("width") or 0)
                height = int(streams[0].get("height") or 0)
                if width > 0 and height > 0:
                    return width, height
        except (subprocess.CalledProcessError, json.JSONDecodeError, ValueError, TypeError):
            pass

    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(video)],
        capture_output=True,
        text=True,
    )
    for line in result.stderr.splitlines():
        if "Video:" not in line:
            continue
        match = VIDEO_RESOLUTION_PATTERN.search(line)
        if match:
            return int(match.group("width")), int(match.group("height"))
    raise ValueError(f"无法读取视频分辨率，不能生成与预览一致的字幕样式：{video}")


def run_ffmpeg(
    ffmpeg: str,
    video: Path,
    audio: Path,
    ass_path: Path,
    output_video: Path,
    crf: int,
    preset: str,
) -> None:
    ass_filter_name = ass_path.name.replace("\\", r"\\").replace("'", r"\'").replace(":", r"\:")
    command = [
        ffmpeg,
        "-hide_banner",
        "-y",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-filter_complex",
        f"[0:v:0]ass=filename='{ass_filter_name}'[video]",
        "-map",
        "[video]",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-map_metadata",
        "0",
        "-movflags",
        "+faststart",
        "-shortest",
        str(output_video),
    ]
    subprocess.run(command, cwd=ass_path.parent, check=True)


def write_reference_frames(ffmpeg: str, video: Path, output_dir: Path, cues: list[SubtitleCue]) -> list[Path]:
    preview_dir = output_dir / "字幕样式参考帧"
    preview_dir.mkdir(parents=True, exist_ok=True)
    cue = cues[len(cues) // 2]
    timestamp = max(0.0, (cue.start_ms + cue.end_ms) / 2000)
    output_path = preview_dir / "字幕编辑参考帧.jpg"
    command = [
        ffmpeg,
        "-hide_banner",
        "-y",
        "-ss",
        f"{timestamp:.3f}",
        "-i",
        str(video),
        "-frames:v",
        "1",
        "-update",
        "1",
        "-q:v",
        "2",
        str(output_path),
    ]
    subprocess.run(command, cwd=output_dir, check=True)
    return [output_path]


def write_report(
    path: Path,
    video: Path,
    audio: Path,
    subtitle: Path,
    ass_path: Path,
    output_video: Path,
    cues: list[SubtitleCue],
) -> None:
    duration = cues[-1].end_ms / 1000
    content = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>英文配音视频成片结果</title>
<style>
body {{ font-family: "Microsoft YaHei UI", sans-serif; max-width: 1120px; margin: 32px auto; color: #17212b; background: #f4f5f2; }}
.panel {{ background: #fff; padding: 24px 28px; margin: 16px 0; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }}
h1, h2 {{ margin: 0 0 14px; color: #12202e; }}
p {{ line-height: 1.65; margin: 8px 0; }}
code {{ word-break: break-all; color: #245a52; }}
video {{ width: 100%; max-height: 620px; background: #111; border-radius: 8px; }}
</style>
</head>
<body>
<section class="panel">
<h1>英文配音视频成片结果</h1>
<p>原视频声音已移除，音频轨已替换为英文配音混音轨；英文字幕通过 ASS 样式排布在原视频中文字幕正上方，形成紧凑的双语字幕区。</p>
<p>字幕条目：<strong>{len(cues)}</strong>；最后字幕时间：<strong>{duration:.3f}s</strong>。</p>
</section>
<section class="panel">
<h2>成片预览</h2>
<video controls preload="metadata" src="{html.escape(output_video.name)}"></video>
</section>
<section class="panel">
<h2>输入与输出</h2>
<p>原视频：<code>{html.escape(str(video))}</code></p>
<p>英文混音音轨：<code>{html.escape(str(audio))}</code></p>
<p>英文翻译字幕：<code>{html.escape(str(subtitle))}</code></p>
<p>成片用 ASS：<code>{html.escape(str(ass_path))}</code></p>
<p>最终视频：<code>{html.escape(str(output_video))}</code></p>
</section>
</body>
</html>
"""
    path.write_text(content, encoding="utf-8")


def main() -> int:
    args = parse_args()
    video = Path(args.video).resolve()
    audio = Path(args.audio).resolve() if args.audio else None
    subtitle = Path(args.subtitle).resolve()
    output_dir = Path(args.output_dir).resolve()
    required_paths = [("原视频", video), ("英文翻译字幕", subtitle)]
    if not args.preview_only:
        if audio is None:
            raise ValueError("生成最终视频时必须提供英文混音音轨。")
        required_paths.append(("英文混音音轨", audio))
    for label, path in required_paths:
        if not path.is_file():
            raise FileNotFoundError(f"找不到{label}：{path}")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法生成最终英文配音视频。")
    ffprobe = shutil.which("ffprobe")

    output_dir.mkdir(parents=True, exist_ok=True)
    ass_path = output_dir / f"{args.output_prefix}_英文上方字幕.ass"
    output_video = output_dir / f"{args.output_prefix}_内嵌英文字幕.mp4"
    report_path = output_dir / "英文配音视频成片结果.html"
    existing = [path for path in (ass_path, output_video, report_path) if path.exists()]
    if existing and not args.overwrite:
        raise FileExistsError(f"已有最终成片输出：{existing[0]}。需要替换时请传入 --overwrite。")

    cues = load_srt(subtitle)
    play_res_width, play_res_height = probe_video_resolution(video, ffmpeg, ffprobe)
    write_ass(
        ass_path,
        cues,
        args.font_name,
        args.font_size,
        args.text_color,
        args.background_color,
        args.background_opacity,
        args.position_x,
        args.position_y,
        play_res_width,
        play_res_height,
    )
    print(f"成片用英文 ASS 已生成（位于中文字幕上方并保留行距）：{ass_path}", flush=True)
    preview_paths = write_reference_frames(ffmpeg, video, output_dir, cues)
    for preview_path in preview_paths:
        print(f"字幕样式参考帧：{preview_path}", flush=True)
    if args.preview_only:
        return 0
    if audio is None:
        raise ValueError("生成最终视频时必须提供英文混音音轨。")
    print(f"开始移除原音轨、替换英文混音音轨并烧录英文字幕：{video}", flush=True)
    run_ffmpeg(ffmpeg, video, audio, ass_path, output_video, args.crf, args.preset)
    write_report(report_path, video, audio, subtitle, ass_path, output_video, cues)
    print(f"最终英文配音视频：{output_video}", flush=True)
    print(f"成片结果报告：{report_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
