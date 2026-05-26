from __future__ import annotations

import argparse
import html
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


TIME_PATTERN = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
SPEAKER_PATTERN = re.compile(r"^\[[^\]]+\]\s*", re.DOTALL)
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


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
    parser.add_argument("--bottom-margin", type=int, default=148, help="英文 ASS 下边距，用于在中文字幕上方留出清晰行距")
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
        dialogue = SPEAKER_PATTERN.sub("", "\n".join(lines[2:]).strip(), count=1).strip()
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
    bottom_margin: int,
) -> None:
    primary_colour = ass_color(text_color)
    back_colour = ass_color(background_color, background_opacity)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: EnglishAboveChinese,{font_name},{font_size},{primary_colour},{primary_colour},{back_colour},{back_colour},-1,0,0,0,100,100,0.2,0,3,2.4,0,2,100,100,{bottom_margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with path.open("w", encoding="utf-8-sig", newline="\n") as output:
        output.write(header)
        for cue in cues:
            output.write(
                "Dialogue: 0,"
                f"{ass_time(cue.start_ms)},{ass_time(cue.end_ms)},"
                f"EnglishAboveChinese,,0,0,0,,{ass_escape(cue.text)}\n"
            )


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


def write_reference_frames(ffmpeg: str, video: Path, ass_path: Path, output_dir: Path, cues: list[SubtitleCue]) -> list[Path]:
    preview_dir = output_dir / "字幕样式参考帧"
    preview_dir.mkdir(parents=True, exist_ok=True)
    sample_indices = sorted({0, len(cues) // 2, len(cues) - 1})
    ass_filter_name = ass_path.name.replace("\\", r"\\").replace("'", r"\'").replace(":", r"\:")
    outputs: list[Path] = []
    for position, cue_index in enumerate(sample_indices, start=1):
        cue = cues[cue_index]
        timestamp = max(0.0, (cue.start_ms + cue.end_ms) / 2000)
        output_path = preview_dir / f"参考帧_{position:02d}.jpg"
        command = [
            ffmpeg,
            "-hide_banner",
            "-y",
            "-i",
            str(video),
            "-vf",
            f"ass=filename='{ass_filter_name}'",
            "-ss",
            f"{timestamp:.3f}",
            "-frames:v",
            "1",
            "-update",
            "1",
            "-q:v",
            "2",
            str(output_path),
        ]
        subprocess.run(command, cwd=ass_path.parent, check=True)
        outputs.append(output_path)
    return outputs


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

    output_dir.mkdir(parents=True, exist_ok=True)
    ass_path = output_dir / f"{args.output_prefix}_英文上方字幕.ass"
    output_video = output_dir / f"{args.output_prefix}_内嵌英文字幕.mp4"
    report_path = output_dir / "英文配音视频成片结果.html"
    existing = [path for path in (ass_path, output_video, report_path) if path.exists()]
    if existing and not args.overwrite:
        raise FileExistsError(f"已有最终成片输出：{existing[0]}。需要替换时请传入 --overwrite。")

    cues = load_srt(subtitle)
    write_ass(
        ass_path,
        cues,
        args.font_name,
        args.font_size,
        args.text_color,
        args.background_color,
        args.background_opacity,
        args.bottom_margin,
    )
    print(f"成片用英文 ASS 已生成（位于中文字幕上方并保留行距）：{ass_path}", flush=True)
    preview_paths = write_reference_frames(ffmpeg, video, ass_path, output_dir, cues)
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
