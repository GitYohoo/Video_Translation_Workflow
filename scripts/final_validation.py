from __future__ import annotations

import argparse
import html
import json
import shutil
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按指定时间段修补英文成片音频。")
    parser.add_argument("--base-video", required=True, help="第五步生成的英文成片")
    parser.add_argument("--source-video", required=True, help="原视频")
    parser.add_argument("--dialogue", required=True, help="英文对白整轨")
    parser.add_argument("--background", required=True, help="MX+FX 无对白背景底轨")
    parser.add_argument("--config", required=True, help="最终验证配置 JSON")
    parser.add_argument("--output-video", required=True, help="最终验证成片输出路径")
    parser.add_argument("--report", required=True, help="最终验证 HTML 报告")
    return parser.parse_args()


def format_range_condition(ranges: list[dict[str, float]]) -> str:
    return "+".join(
        f"between(t,{item['start']:.6f},{item['end']:.6f})"
        for item in ranges
    )


def append_mute_filters(source_label: str, ranges: list[dict[str, float]], prefix: str):
    filters: list[str] = []
    current = source_label
    for index, item in enumerate(ranges, start=1):
        output = f"[{prefix}{index}]"
        filters.append(
            f"{current}volume=0:enable='between(t,{item['start']:.6f},{item['end']:.6f})'{output}"
        )
        current = output
    return filters, current


def build_filter_complex(
    source_audio_ranges: list[dict[str, float]],
    muted_background_ranges: list[dict[str, float]],
) -> tuple[str, str]:
    initial_background_label = (
        "[background0]" if muted_background_ranges else "[background]"
    )
    filters = [
        "[1:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[dialogue]",
        "[2:a:0]aresample=44100,"
        "aformat=sample_fmts=fltp:channel_layouts=stereo"
        f"{initial_background_label}",
    ]
    background_filters, background_label = append_mute_filters(
        "[background0]", muted_background_ranges, "background"
    )
    filters.extend(background_filters)
    if not muted_background_ranges:
        background_label = "[background]"
    filters.append(
        f"[dialogue]{background_label}amix=inputs=2:duration=longest:normalize=0[base]"
    )
    if not source_audio_ranges:
        return ";".join(filters), "[base]"

    base_filters, base_label = append_mute_filters(
        "[base]", source_audio_ranges, "baseMuted"
    )
    filters.extend(base_filters)
    condition = format_range_condition(source_audio_ranges)
    filters.append(
        "[3:a:0]aresample=44100,"
        "aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"volume=0:enable='not({condition})'[sourceSelected]"
    )
    filters.append(
        f"{base_label}[sourceSelected]amix=inputs=2:duration=longest:normalize=0[verified]"
    )
    return ";".join(filters), "[verified]"


def load_configuration(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    return {
        "sourceAudioRanges": value.get("sourceAudioRanges", []),
        "mutedBackgroundRanges": value.get("mutedBackgroundRanges", []),
    }


def render_video(
    ffmpeg: str,
    base_video: Path,
    source_video: Path,
    dialogue: Path,
    background: Path,
    output_video: Path,
    configuration: dict,
) -> None:
    source_ranges = configuration["sourceAudioRanges"]
    filter_graph, audio_label = build_filter_complex(
        source_ranges,
        configuration["mutedBackgroundRanges"],
    )
    command = [
        ffmpeg,
        "-hide_banner",
        "-y",
        "-i",
        str(base_video),
        "-i",
        str(dialogue),
        "-i",
        str(background),
    ]
    if source_ranges:
        command.extend(["-i", str(source_video)])
    command.extend(
        [
            "-filter_complex",
            filter_graph,
            "-map",
            "0:v:0",
            "-map",
            audio_label,
            "-c:v",
            "copy",
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
    )
    subprocess.run(command, check=True)


def range_rows(ranges: list[dict[str, float]]) -> str:
    if not ranges:
        return "<li>无</li>"
    return "".join(
        f"<li>{item['start']:.3f}s - {item['end']:.3f}s</li>"
        for item in ranges
    )


def write_report(path: Path, output_video: Path, configuration: dict) -> None:
    content = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>最终验证结果</title>
<style>
body {{ font-family: "Microsoft YaHei UI", sans-serif; max-width: 1080px; margin: 32px auto; color: #17212b; }}
section {{ border: 1px solid #dfe6e3; border-radius: 12px; margin: 16px 0; padding: 20px 24px; }}
video {{ background: #111; width: 100%; }}
</style>
</head>
<body>
<section><h1>最终验证成片</h1><video controls src="{html.escape(output_video.name)}"></video></section>
<section><h2>使用原视频音频的时间段</h2><ul>{range_rows(configuration['sourceAudioRanges'])}</ul></section>
<section><h2>清除 MX+FX 背景底轨的时间段</h2><ul>{range_rows(configuration['mutedBackgroundRanges'])}</ul></section>
</body>
</html>
"""
    path.write_text(content, encoding="utf-8")


def main() -> int:
    args = parse_args()
    base_video = Path(args.base_video).resolve()
    source_video = Path(args.source_video).resolve()
    dialogue = Path(args.dialogue).resolve()
    background = Path(args.background).resolve()
    config_path = Path(args.config).resolve()
    output_video = Path(args.output_video).resolve()
    report_path = Path(args.report).resolve()
    for label, file_path in [
        ("第五步英文成片", base_video),
        ("原视频", source_video),
        ("英文对白整轨", dialogue),
        ("MX+FX 无对白背景底轨", background),
        ("最终验证配置", config_path),
    ]:
        if not file_path.is_file():
            raise FileNotFoundError(f"找不到{label}：{file_path}")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法生成最终验证成片。")
    configuration = load_configuration(config_path)
    output_video.parent.mkdir(parents=True, exist_ok=True)
    render_video(
        ffmpeg,
        base_video,
        source_video,
        dialogue,
        background,
        output_video,
        configuration,
    )
    write_report(report_path, output_video, configuration)
    print(f"最终验证成片：{output_video}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
