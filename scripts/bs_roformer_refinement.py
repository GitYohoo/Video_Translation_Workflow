from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


MODEL_FILENAME = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
AUDIO_SEPARATOR_ENTRYPOINT = "from audio_separator.utils.cli import main; main()"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 BS-RoFormer 从原视频生成 DX 与 MX+FX 二轨。")
    parser.add_argument("--video", required=True, help="输入视频文件路径")
    parser.add_argument("--runtime-dir", required=True, help="运行资源目录")
    parser.add_argument("--output-root", help="可选输出根目录；默认使用视频名命名的二轨分离目录")
    return parser.parse_args()


def run_command(command: list[str]) -> None:
    subprocess.run(command, check=True)


def extract_fullband_audio(ffmpeg: Path, video: Path, audio_path: Path) -> None:
    run_command(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            str(audio_path),
        ]
    )


def separate_dialogue_and_background(
    model_dir: Path,
    audio_path: Path,
    output_dir: Path,
    video_stem: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    custom_names = json.dumps(
        {
            "Vocals": f"{video_stem}_DX_对白轨",
            "Instrumental": f"{video_stem}_MX+FX_无对白背景底轨",
        },
        ensure_ascii=False,
    )
    run_command(
        [
            sys.executable,
            "-c",
            AUDIO_SEPARATOR_ENTRYPOINT,
            "--model_file_dir",
            str(model_dir),
            "--model_filename",
            MODEL_FILENAME,
            "--output_dir",
            str(output_dir),
            "--output_format",
            "WAV",
            "--sample_rate",
            "44100",
            "--use_soundfile",
            "--custom_output_names",
            custom_names,
            "--log_level",
            "info",
            str(audio_path),
        ]
    )


def main() -> int:
    args = parse_args()
    video = Path(args.video).resolve()
    runtime_dir = Path(args.runtime_dir).resolve()
    ffmpeg_command = shutil.which("ffmpeg")
    model_dir = runtime_dir / "bs-roformer-models"
    model_path = model_dir / MODEL_FILENAME

    if not video.is_file():
        raise FileNotFoundError(f"找不到输入视频：{video}")
    if not ffmpeg_command:
        raise FileNotFoundError("找不到 FFmpeg，请确认其 bin 目录已加入 PATH。")
    if not model_path.is_file():
        raise FileNotFoundError(f"找不到 BS-RoFormer 模型：{model_path}")
    try:
        from audio_separator.utils.cli import main as _audio_separator_main
    except ImportError as error:
        raise FileNotFoundError("当前 Python 环境缺少 audio-separator 包。") from error

    output_root = (
        Path(args.output_root).resolve()
        if args.output_root
        else video.parent / f"{video.stem}_BS-RoFormer_二轨分离"
    )
    work_dir = output_root / "工作文件"
    stems_output_dir = output_root / "输出音轨"
    fullband_audio = work_dir / "input_fullband_44k_stereo.wav"
    ffmpeg = Path(ffmpeg_command).resolve()

    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"正在提取全频段音轨：{fullband_audio}", flush=True)
    extract_fullband_audio(ffmpeg, video, fullband_audio)
    print("正在生成 DX 对白轨与 MX+FX 无对白背景底轨...", flush=True)
    separate_dialogue_and_background(
        model_dir,
        fullband_audio,
        stems_output_dir,
        video.stem,
    )

    expected_outputs = (
        stems_output_dir / f"{video.stem}_DX_对白轨.wav",
        stems_output_dir / f"{video.stem}_MX+FX_无对白背景底轨.wav",
    )
    missing_outputs = [str(path) for path in expected_outputs if not path.is_file()]
    if missing_outputs:
        raise RuntimeError("缺少输出音轨：" + "、".join(missing_outputs))

    print("BS-RoFormer 二轨分离完成：", flush=True)
    for output in expected_outputs:
        print(str(output), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"外部处理步骤执行失败，退出码：{exc.returncode}", file=sys.stderr)
        raise SystemExit(exc.returncode)
    except Exception as exc:
        print(f"处理失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
