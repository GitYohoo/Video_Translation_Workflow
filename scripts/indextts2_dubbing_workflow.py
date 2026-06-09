from __future__ import annotations

import argparse
import csv
import html
import json
import re
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO


INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
PRESERVE_ORIGINAL = "preserve_original"
TTS_SEGMENT = "tts"


@dataclass(frozen=True)
class Segment:
    number: int
    start: str
    end: str
    duration: float
    speaker: str
    text: str
    source_audio: Path
    role: str
    segment_type: str = TTS_SEGMENT
    preserve_audio: Path | None = None

    @property
    def should_synthesize(self) -> bool:
        return self.segment_type != PRESERVE_ORIGINAL


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 IndexTTS2 按角色固定音色生成英文配音片段。")
    parser.add_argument("--manifest", required=True, help="英文配音分段清单 CSV")
    parser.add_argument("--output-dir", required=True, help="IndexTTS2 配音输出目录")
    parser.add_argument("--model-dir", required=True, help="IndexTTS2 官方模型目录")
    parser.add_argument("--index-code-dir", required=True, help="IndexTTS2 官方代码目录")
    parser.add_argument("--role-map-json", help="可选角色映射 JSON，用于修正未标注或候选角色")
    parser.add_argument("--progress-log", help="可选的 UTF-8 运行日志文件")
    parser.add_argument("--prepare-only", action="store_true", help="仅生成角色参考音色库与计划清单")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已有参考音色和已合成片段")
    parser.add_argument("--use-fp16", action="store_true", help="在 CUDA 上使用 FP16 推理")
    parser.add_argument("--start-number", type=int, default=1, help="从指定字幕编号开始合成")
    parser.add_argument("--max-segments", type=int, help="最多合成的片段数，用于抽样测试")
    parser.add_argument(
        "--emotion-alpha",
        type=float,
        default=0.6,
        help="逐段原声情绪参考强度，范围 0 至 1，默认 0.6",
    )
    parser.add_argument(
        "--disable-segment-emotion",
        action="store_true",
        help="不使用逐段原声作为情绪参考，仅复刻角色音色",
    )
    return parser.parse_args()


class TeeStream:
    def __init__(self, primary: TextIO, logfile: TextIO) -> None:
        self.primary = primary
        self.logfile = logfile

    def write(self, text: str) -> int:
        self.primary.write(text)
        self.primary.flush()
        self.logfile.write(text)
        self.logfile.flush()
        return len(text)

    def flush(self) -> None:
        self.primary.flush()
        self.logfile.flush()

    def __getattr__(self, name: str):
        return getattr(self.primary, name)


def configure_progress_log(path_value: str | None) -> TextIO | None:
    if not path_value:
        return None
    path = Path(path_value).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    logfile = path.open("a", encoding="utf-8", newline="\n")
    sys.stdout = TeeStream(sys.stdout, logfile)
    sys.stderr = TeeStream(sys.stderr, logfile)
    print("\n===== 新的 IndexTTS2 运行尝试 =====", flush=True)
    print(f"运行日志：{path}", flush=True)
    return logfile


def safe_name(value: str) -> str:
    value = INVALID_FILENAME_CHARS.sub("_", value.strip())
    value = re.sub(r"\s+", "_", value).strip("._")
    return value or "未命名"


def load_role_overrides(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    with path.open("r", encoding="utf-8-sig") as source:
        data = json.load(source)
    if isinstance(data, dict) and "角色映射" in data:
        data = data["角色映射"]
    if not isinstance(data, dict) or not all(
        isinstance(source, str) and isinstance(target, str)
        for source, target in data.items()
    ):
        raise ValueError("角色映射 JSON 必须是字符串到字符串的对象，可选外层键为“角色映射”。")
    return data


def resolved_role(speaker: str, number: int, overrides: dict[str, str], per_segment_role: bool = False) -> str:
    specific_key = f"{speaker}#{number:03d}"
    if per_segment_role:
        return overrides.get(specific_key, specific_key)
    if specific_key in overrides:
        return overrides[specific_key]
    if speaker in overrides:
        return overrides[speaker]
    if speaker == "未标注":
        return specific_key
    return speaker


def load_segments(manifest: Path, overrides: dict[str, str], per_segment_role: bool = False) -> list[Segment]:
    segments: list[Segment] = []
    with manifest.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            number = int(row["编号"])
            source_audio = (manifest.parent / row["音频文件"]).resolve()
            if not source_audio.is_file():
                raise FileNotFoundError(f"找不到第 {number} 段原对白片段：{source_audio}")
            segment_type = row.get("段类型", TTS_SEGMENT).strip() or TTS_SEGMENT
            if segment_type not in {TTS_SEGMENT, PRESERVE_ORIGINAL}:
                segment_type = TTS_SEGMENT
            preserve_audio_value = row.get("保留原声文件", "").strip()
            preserve_audio = (manifest.parent / preserve_audio_value).resolve() if preserve_audio_value else None
            if segment_type == PRESERVE_ORIGINAL:
                if preserve_audio is None or not preserve_audio.is_file():
                    raise FileNotFoundError(f"找不到第 {number} 段保留原声片段：{preserve_audio_value}")
            segments.append(
                Segment(
                    number=number,
                    start=row["开始时间"],
                    end=row["结束时间"],
                    duration=float(row["时长秒"]),
                    speaker=row["说话人"],
                    text=row["英文台词"].strip(),
                    source_audio=source_audio,
                    role=resolved_role(row["说话人"], number, overrides, per_segment_role),
                    segment_type=segment_type,
                    preserve_audio=preserve_audio,
                )
            )
    if not segments:
        raise ValueError("配音清单中没有可合成的片段。")
    return segments


def prepare_dirs(output_dir: Path) -> dict[str, Path]:
    dirs = {
        "references": output_dir / "参考音色",
        "raw": output_dir / "原始合成",
        "fitted": output_dir / "时长适配片段",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for directory in dirs.values():
        directory.mkdir(parents=True, exist_ok=True)
    return dirs


def audio_params(path: Path) -> wave._wave_params:
    with wave.open(str(path), "rb") as source:
        return source.getparams()


def audio_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as source:
        return source.getnframes() / source.getframerate()


def build_reference_audio(
    role: str,
    role_segments: list[Segment],
    output_path: Path,
    overwrite: bool,
    max_seconds: float = 12.0,
) -> list[int]:
    ranked = sorted(role_segments, key=lambda segment: (-segment.duration, segment.number))
    with wave.open(str(ranked[0].source_audio), "rb") as first:
        params = first.getparams()
    maximum_frames = round(max_seconds * params.framerate)
    silence_frames = round(0.12 * params.framerate)
    selected: list[int] = []
    written_frames = 0
    for segment in ranked:
        with wave.open(str(segment.source_audio), "rb") as source:
            if (
                source.getnchannels() != params.nchannels
                or source.getsampwidth() != params.sampwidth
                or source.getframerate() != params.framerate
            ):
                raise ValueError(f"角色 {role} 的参考音频格式不一致：{segment.source_audio}")
            gap = silence_frames if selected else 0
            remaining = maximum_frames - written_frames - gap
            if remaining <= 0:
                break
            written_frames += gap + min(source.getnframes(), remaining)
            selected.append(segment.number)
            if written_frames >= maximum_frames:
                break
    if output_path.exists() and not overwrite:
        return selected

    silence = b"\x00" * silence_frames * params.sampwidth * params.nchannels
    written_frames = 0
    with wave.open(str(output_path), "wb") as output:
        output.setparams(params)
        for segment in ranked:
            if segment.number not in selected:
                continue
            with wave.open(str(segment.source_audio), "rb") as source:
                gap = silence_frames if written_frames else 0
                remaining = maximum_frames - written_frames - gap
                if remaining <= 0:
                    break
                frames_to_read = min(source.getnframes(), remaining)
                if written_frames:
                    output.writeframes(silence)
                    written_frames += silence_frames
                output.writeframes(source.readframes(frames_to_read))
                written_frames += frames_to_read
                if written_frames >= maximum_frames:
                    break
    return selected


def prepare_references(
    segments: list[Segment], output_dir: Path, overwrite: bool
) -> tuple[dict[str, Path], dict[str, list[int]]]:
    references_dir = output_dir / "参考音色"
    groups: dict[str, list[Segment]] = {}
    for segment in segments:
        if not segment.should_synthesize:
            continue
        groups.setdefault(segment.role, []).append(segment)
    references: dict[str, Path] = {}
    selected: dict[str, list[int]] = {}
    for role, role_segments in sorted(groups.items()):
        reference = references_dir / f"{safe_name(role)}.wav"
        chosen = build_reference_audio(role, role_segments, reference, overwrite)
        if not reference.is_file():
            raise RuntimeError(f"没有生成角色参考音色：{role}")
        references[role] = reference
        selected[role] = chosen
    return references, selected


def write_role_plan(
    output_dir: Path,
    segments: list[Segment],
    references: dict[str, Path],
    selected: dict[str, list[int]],
) -> Path:
    path = output_dir / "角色音色方案.json"
    roles: dict[str, dict] = {}
    for role, reference in references.items():
        role_segments = [segment for segment in segments if segment.role == role]
        roles[role] = {
            "参考音色": str(reference),
            "参考来源编号": selected.get(role, []),
            "片段数量": len(role_segments),
            "字幕编号": [segment.number for segment in role_segments],
        }
    data = {
        "说明": "默认同一角色使用固定音色；启用逐段参考模式时，每个分段使用自己的原始 DX 对白片段作为参考音色。",
        "角色": roles,
        "逐段角色": {
            f"{segment.number:03d}": {
                "角色": segment.role,
                "段类型": segment.segment_type,
            }
            for segment in segments
        },
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def atempo_chain(factor: float) -> str:
    factors: list[float] = []
    while factor > 2.0:
        factors.append(2.0)
        factor /= 2.0
    while factor < 0.5:
        factors.append(0.5)
        factor /= 0.5
    if abs(factor - 1.0) > 0.0001 or not factors:
        factors.append(factor)
    return ",".join(f"atempo={value:.8f}" for value in factors)


def fit_duration(ffmpeg: str, raw_path: Path, output_path: Path, target_duration: float) -> float:
    generated_duration = audio_duration(raw_path)
    speed_factor = generated_duration / target_duration
    filters = (
        f"{atempo_chain(speed_factor)},"
        f"apad=pad_dur={target_duration:.6f},atrim=duration={target_duration:.6f}"
    )
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(raw_path),
            "-af",
            filters,
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
    return speed_factor


def load_existing_results(output_dir: Path) -> dict[int, dict[str, str]]:
    path = output_dir / "IndexTTS2_英文配音清单.csv"
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return {int(row["编号"]): row for row in csv.DictReader(source)}


def write_result_csv(output_dir: Path, result_rows: list[dict]) -> Path:
    path = output_dir / "IndexTTS2_英文配音清单.csv"
    columns = [
        "编号",
        "开始时间",
        "结束时间",
        "目标时长秒",
        "角色",
        "生成方式",
        "参考音色",
        "英文台词",
        "原始合成",
        "时长适配片段",
        "保留原声片段",
        "原始时长秒",
        "变速系数",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(sorted(result_rows, key=lambda row: int(row["编号"])))
    return path


def write_result_html(
    output_dir: Path,
    segments: list[Segment],
    references: dict[str, Path],
    result_rows: list[dict],
    model_dir: Path,
) -> Path:
    rows_by_number = {int(row["编号"]): row for row in result_rows}
    table_rows: list[str] = []
    for segment in segments:
        result = rows_by_number.get(segment.number)
        fitted_player = ""
        speed = ""
        if result:
            relative = html.escape(result["时长适配片段"].replace("\\", "/"))
            fitted_player = f'<audio controls preload="none" src="{relative}"></audio>'
            speed = html.escape(result["变速系数"])
        table_rows.append(
            "<tr>"
            f"<td>{segment.number:03d}</td>"
            f"<td>{html.escape(segment.role)}</td>"
            f"<td>{html.escape(segment.segment_type)}</td>"
            f"<td>{html.escape(segment.start)} - {html.escape(segment.end)}</td>"
            f"<td>{segment.duration:.3f}s</td>"
            f"<td>{html.escape(segment.text)}</td>"
            f"<td>{speed}</td>"
            f"<td>{fitted_player}</td>"
            "</tr>"
        )
    role_rows = "".join(
        "<tr>"
        f"<td>{html.escape(role)}</td>"
        f"<td>{sum(1 for segment in segments if segment.role == role)}</td>"
        f'<td><audio controls preload="none" src="参考音色/{html.escape(reference.name)}"></audio></td>'
        "</tr>"
        for role, reference in sorted(references.items())
    )
    page = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>IndexTTS2 英文配音结果</title>
  <style>
    body {{ max-width: 1500px; margin: 28px auto; padding: 0 22px; font-family: "Microsoft YaHei", Arial, sans-serif; color: #111827; line-height: 1.55; }}
    h1, h2 {{ color: #111827; }}
    .note {{ background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 18px 0; }}
    code {{ font-family: Consolas, monospace; word-break: break-all; }}
    table {{ width: 100%; border-collapse: collapse; margin: 14px 0 26px; font-size: 14px; }}
    th, td {{ border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }}
    th {{ background: #f3f4f6; position: sticky; top: 0; text-align: left; }}
    td:nth-child(1), td:nth-child(3), td:nth-child(4), td:nth-child(6) {{ white-space: nowrap; }}
    audio {{ width: 260px; height: 32px; }}
  </style>
</head>
<body>
  <h1>IndexTTS2 英文配音结果</h1>
  <div class="note">
    <p>模型：<code>{html.escape(str(model_dir))}</code></p>
    <p>角色数量：<strong>{len(references)}</strong>；字幕片段：<strong>{len(segments)}</strong>；已生成或保留：<strong>{len(result_rows)}</strong>。</p>
    <p><code>tts</code> 段由角色固定参考音频控制；<code>preserve_original</code> 段跳过 TTS，直接铺回原始非语言人声。输出片段均会通过 FFmpeg 时长适配为字幕原始时间窗长度。</p>
  </div>
  <h2>角色参考音色</h2>
  <table>
    <thead><tr><th>角色</th><th>台词段数</th><th>参考音频</th></tr></thead>
    <tbody>{role_rows}</tbody>
  </table>
  <h2>逐段英文配音</h2>
  <table>
    <thead><tr><th>编号</th><th>角色</th><th>段类型</th><th>时间段</th><th>目标时长</th><th>英文台词</th><th>变速系数</th><th>适配后试听</th></tr></thead>
    <tbody>{''.join(table_rows)}</tbody>
  </table>
</body>
</html>
"""
    path = output_dir / "IndexTTS2_英文配音结果.html"
    path.write_text(page, encoding="utf-8", newline="\n")
    return path


def generate_dubbing(
    args: argparse.Namespace,
    segments: list[Segment],
    references: dict[str, Path],
    output_dir: Path,
) -> list[dict]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法执行配音时长适配。")
    raw_dir = output_dir / "原始合成"
    fitted_dir = output_dir / "时长适配片段"
    selected = [segment for segment in segments if segment.number >= args.start_number]
    if args.max_segments:
        selected = selected[: args.max_segments]
    selected.sort(key=lambda segment: (segment.role, segment.number))
    existing_results = load_existing_results(output_dir)

    def reusable_raw_audio(segment: Segment, raw_path: Path) -> bool:
        previous = existing_results.get(segment.number)
        return (
            not args.overwrite
            and raw_path.exists()
            and previous is not None
            and previous["角色"] == segment.role
            and previous["英文台词"].strip() == segment.text
        )

    needs_synthesis = args.overwrite or any(
        not reusable_raw_audio(segment, raw_dir / f"{segment.number:03d}_{safe_name(segment.role)}.wav")
        for segment in selected
        if segment.should_synthesize
    )
    tts = None
    if needs_synthesis:
        code_dir = Path(args.index_code_dir).resolve()
        sys.path.insert(0, str(code_dir))
        from indextts.infer_v2 import IndexTTS2

        model_dir = Path(args.model_dir).resolve()
        tts = IndexTTS2(
            cfg_path=str(model_dir / "config.yaml"),
            model_dir=str(model_dir),
            use_fp16=args.use_fp16,
            use_cuda_kernel=False,
            use_deepspeed=False,
        )
    else:
        print("所选片段已全部存在，跳过 IndexTTS2 模型初始化。", flush=True)
    results: list[dict] = []
    for index, segment in enumerate(selected, start=1):
        filename = f"{segment.number:03d}_{safe_name(segment.role)}.wav"
        raw_path = raw_dir / filename
        fitted_path = fitted_dir / filename
        if not segment.should_synthesize:
            if segment.preserve_audio is None:
                raise FileNotFoundError(f"第 {segment.number:03d} 段缺少保留原声片段。")
            fitted_duration = audio_duration(fitted_path) if fitted_path.exists() else None
            if args.overwrite or fitted_duration is None or abs(fitted_duration - segment.duration) > 0.001:
                speed_factor = fit_duration(ffmpeg, segment.preserve_audio, fitted_path, segment.duration)
            else:
                speed_factor = audio_duration(segment.preserve_audio) / segment.duration
            print(f"[{index}/{len(selected)}] 保留原声第 {segment.number:03d} 段：{fitted_path.name}", flush=True)
        elif reusable_raw_audio(segment, raw_path):
            fitted_duration = audio_duration(fitted_path) if fitted_path.exists() else None
            if fitted_duration is None or abs(fitted_duration - segment.duration) > 0.001:
                speed_factor = fit_duration(ffmpeg, raw_path, fitted_path, segment.duration)
                print(
                    f"[{index}/{len(selected)}] 时间窗已变化，重新适配第 {segment.number:03d} 段："
                    f"{fitted_path.name}",
                    flush=True,
                )
            else:
                speed_factor = audio_duration(raw_path) / segment.duration
                print(f"[{index}/{len(selected)}] 已存在，跳过第 {segment.number:03d} 段：{fitted_path.name}", flush=True)
        else:
            if tts is None:
                raise RuntimeError("需要合成新片段，但 IndexTTS2 尚未初始化。")
            print(
                f"[{index}/{len(selected)}] 合成第 {segment.number:03d} 段："
                f"{segment.role} / {segment.text}",
                flush=True,
            )
            infer_options: dict = {
                "spk_audio_prompt": str(references[segment.role]),
                "text": segment.text,
                "output_path": str(raw_path),
                "use_random": False,
                "verbose": False,
            }
            if not args.disable_segment_emotion and segment.duration >= 0.8:
                infer_options["emo_audio_prompt"] = str(segment.source_audio)
                infer_options["emo_alpha"] = max(0.0, min(1.0, args.emotion_alpha))
            tts.infer(**infer_options)
            speed_factor = fit_duration(ffmpeg, raw_path, fitted_path, segment.duration)
            print(f"[{index}/{len(selected)}] 已完成第 {segment.number:03d} 段：{fitted_path.name}", flush=True)
        results.append(
            {
                "编号": segment.number,
                "开始时间": segment.start,
                "结束时间": segment.end,
                "目标时长秒": f"{segment.duration:.3f}",
                "角色": segment.role,
                "生成方式": "tts" if segment.should_synthesize else PRESERVE_ORIGINAL,
                "参考音色": str(references[segment.role]) if segment.should_synthesize else "",
                "英文台词": segment.text,
                "原始合成": f"原始合成/{raw_path.name}" if segment.should_synthesize else str(segment.preserve_audio),
                "时长适配片段": f"时长适配片段/{fitted_path.name}",
                "保留原声片段": str(segment.preserve_audio) if segment.should_synthesize and segment.preserve_audio else "",
                "原始时长秒": f"{audio_duration(raw_path if segment.should_synthesize else fitted_path):.3f}",
                "变速系数": f"{speed_factor:.4f}",
            }
        )
    return results


def main() -> int:
    args = parse_args()
    progress_log = configure_progress_log(args.progress_log)
    if not 0.0 <= args.emotion_alpha <= 1.0:
        raise ValueError("--emotion-alpha 必须在 0 至 1 之间。")
    manifest = Path(args.manifest).resolve()
    output_dir = Path(args.output_dir).resolve()
    model_dir = Path(args.model_dir).resolve()
    code_dir = Path(args.index_code_dir).resolve()
    if not manifest.is_file():
        raise FileNotFoundError(f"找不到英文配音清单：{manifest}")
    if not (model_dir / "config.yaml").is_file():
        raise FileNotFoundError(f"找不到 IndexTTS2 模型目录：{model_dir}")
    if not (code_dir / "indextts" / "infer_v2.py").is_file():
        raise FileNotFoundError(f"找不到 IndexTTS2 官方代码：{code_dir}")
    overrides_path = Path(args.role_map_json).resolve() if args.role_map_json else None
    overrides = load_role_overrides(overrides_path)
    segments = load_segments(manifest, overrides)
    prepare_dirs(output_dir)
    references, selected = prepare_references(segments, output_dir, args.overwrite)
    role_plan = write_role_plan(output_dir, segments, references, selected)
    print(f"已准备固定角色音色：{len(references)} 个；方案：{role_plan}", flush=True)

    result_rows: list[dict] = []
    if not args.prepare_only:
        result_rows = generate_dubbing(args, segments, references, output_dir)
        result_csv = write_result_csv(output_dir, result_rows)
        print(f"已生成英文配音片段：{len(result_rows)} 个；清单：{result_csv}", flush=True)
    result_html = write_result_html(output_dir, segments, references, result_rows, model_dir)
    print(f"试听报告：{result_html}", flush=True)
    if progress_log:
        sys.stdout = sys.stdout.primary
        sys.stderr = sys.stderr.primary
        progress_log.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"处理失败：{error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
