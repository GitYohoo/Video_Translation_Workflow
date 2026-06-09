from __future__ import annotations

import argparse
import csv
import html
import sys
from pathlib import Path
from typing import TextIO

from indextts2_dubbing_workflow import (
    PRESERVE_ORIGINAL,
    TeeStream,
    audio_duration,
    fit_duration,
    load_role_overrides,
    load_segments,
    prepare_dirs,
    prepare_references,
    safe_name,
    write_role_plan,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 VoxCPM2 生成逐段英文配音片段。")
    parser.add_argument("--manifest", required=True, help="英文配音分段清单 CSV")
    parser.add_argument("--output-dir", required=True, help="VoxCPM 配音输出目录")
    parser.add_argument("--model-id", default="openbmb/VoxCPM2", help="VoxCPM 模型 ID 或本地模型目录")
    parser.add_argument("--role-map-json", help="可选角色映射 JSON，用于修正未标注或候选角色")
    parser.add_argument("--progress-log", help="可选的 UTF-8 运行日志文件")
    parser.add_argument("--prepare-only", action="store_true", help="仅生成角色参考音色库与计划清单")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已有参考音色和已合成片段")
    parser.add_argument("--start-number", type=int, default=1, help="从指定字幕编号开始合成")
    parser.add_argument("--segment-number", type=int, help="只合成指定编号的单个配音片段")
    parser.add_argument("--max-segments", type=int, help="最多合成的片段数，用于抽样测试")
    parser.add_argument("--device", default="auto", help="推理设备：auto、cpu、cuda、cuda:0 等")
    parser.add_argument("--no-optimize", action="store_true", help="禁用 torch.compile 等优化")
    parser.add_argument("--cfg-value", type=float, default=2.0, help="VoxCPM CFG guidance scale")
    parser.add_argument("--inference-timesteps", type=int, default=10, help="VoxCPM 扩散步数")
    parser.add_argument("--normalize", action="store_true", help="启用 VoxCPM 文本规范化")
    parser.add_argument("--denoise", action="store_true", help="对参考音频启用 VoxCPM 降噪")
    parser.add_argument("--voice-control", help="可选的全局声音控制说明，会放在文本开头括号内")
    parser.add_argument(
        "--per-segment-reference",
        action="store_true",
        help="每个分段使用自己的原始 DX 对白片段作为参考音色，不按说话人共用音色",
    )
    return parser.parse_args()


def configure_progress_log(path_value: str | None) -> TextIO | None:
    if not path_value:
        return None
    path = Path(path_value).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    logfile = path.open("a", encoding="utf-8", newline="\n")
    sys.stdout = TeeStream(sys.stdout, logfile)
    sys.stderr = TeeStream(sys.stderr, logfile)
    print("\n===== 新的 VoxCPM 运行尝试 =====", flush=True)
    print(f"运行日志：{path}", flush=True)
    return logfile


def result_csv_path(output_dir: Path) -> Path:
    return output_dir / "VoxCPM_英文配音清单.csv"


def load_existing_results(output_dir: Path) -> dict[int, dict[str, str]]:
    path = result_csv_path(output_dir)
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return {int(row["编号"]): row for row in csv.DictReader(source)}


def write_result_csv(output_dir: Path, result_rows: list[dict]) -> Path:
    path = result_csv_path(output_dir)
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
    segments: list,
    references: dict[str, Path],
    result_rows: list[dict],
    model_id: str,
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
  <title>VoxCPM 英文配音结果</title>
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
  <h1>VoxCPM 英文配音结果</h1>
  <div class="note">
    <p>模型：<code>{html.escape(model_id)}</code></p>
    <p>参考音色数量：<strong>{len(references)}</strong>；字幕片段：<strong>{len(segments)}</strong>；已生成或保留：<strong>{len(result_rows)}</strong>。</p>
    <p><code>tts</code> 段使用对应原始 DX 对白片段作为参考音色；<code>preserve_original</code> 段跳过 TTS，直接铺回原始非语言人声。</p>
  </div>
  <h2>参考音色</h2>
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
    path = output_dir / "VoxCPM_英文配音结果.html"
    path.write_text(page, encoding="utf-8", newline="\n")
    return path


def synth_text(args: argparse.Namespace, text: str) -> str:
    control = (args.voice_control or "").strip()
    if not control:
        return text
    return f"({control}){text}"


def select_segments_for_dubbing(segments: list, args: argparse.Namespace) -> list:
    if args.segment_number is not None:
        selected = [segment for segment in segments if segment.number == args.segment_number]
        if not selected:
            raise ValueError(f"找不到编号 {args.segment_number:03d} 的配音分段。")
        return selected
    selected = [segment for segment in segments if segment.number >= args.start_number]
    if args.max_segments:
        selected = selected[: args.max_segments]
    selected.sort(key=lambda segment: (segment.role, segment.number))
    return selected


def generate_dubbing(
    args: argparse.Namespace,
    segments: list,
    references: dict[str, Path],
    output_dir: Path,
) -> list[dict]:
    import shutil

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("找不到 FFmpeg，无法执行配音时长适配。")

    raw_dir = output_dir / "原始合成"
    fitted_dir = output_dir / "时长适配片段"
    selected = select_segments_for_dubbing(segments, args)
    selected_numbers = {segment.number for segment in selected}
    existing_results = load_existing_results(output_dir)

    def reusable_raw_audio(segment, raw_path: Path) -> bool:
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
    model = None
    if needs_synthesis:
        import torch
        from voxcpm import VoxCPM
        import soundfile as sf

        print(f"Python：{sys.executable}", flush=True)
        print(f"torch：{torch.__version__}；CUDA 构建：{torch.version.cuda}", flush=True)
        print(f"CUDA 可用：{torch.cuda.is_available()}；设备数量：{torch.cuda.device_count()}", flush=True)
        if torch.cuda.is_available():
            print(f"CUDA 设备：{torch.cuda.get_device_name(0)}", flush=True)
        if args.device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError("已要求使用 CUDA，但当前 VoxCPM Python 环境没有可用 GPU。")

        model = VoxCPM.from_pretrained(
            args.model_id,
            load_denoiser=args.denoise,
            device=args.device,
            optimize=not args.no_optimize,
        )
    else:
        print("所选片段已全部存在，跳过 VoxCPM 模型初始化。", flush=True)

    results: list[dict] = [
        row for number, row in existing_results.items() if number not in selected_numbers
    ]
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
            if model is None:
                raise RuntimeError("需要合成新片段，但 VoxCPM 尚未初始化。")
            print(
                f"[{index}/{len(selected)}] 合成第 {segment.number:03d} 段："
                f"{segment.role} / {segment.text}",
                flush=True,
            )
            wav = model.generate(
                text=synth_text(args, segment.text),
                reference_wav_path=str(references[segment.role]),
                cfg_value=args.cfg_value,
                inference_timesteps=args.inference_timesteps,
                normalize=args.normalize,
                denoise=args.denoise,
            )
            sf.write(str(raw_path), wav, model.tts_model.sample_rate)
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
    if args.inference_timesteps < 1:
        raise ValueError("--inference-timesteps 必须大于等于 1。")
    if args.segment_number is not None and args.segment_number < 1:
        raise ValueError("--segment-number 必须大于等于 1。")
    manifest = Path(args.manifest).resolve()
    output_dir = Path(args.output_dir).resolve()
    if not manifest.is_file():
        raise FileNotFoundError(f"找不到英文配音清单：{manifest}")
    overrides_path = Path(args.role_map_json).resolve() if args.role_map_json else None
    overrides = load_role_overrides(overrides_path)
    segments = load_segments(manifest, overrides, per_segment_role=args.per_segment_reference)
    prepare_dirs(output_dir)
    references, selected = prepare_references(segments, output_dir, args.overwrite)
    role_plan = write_role_plan(output_dir, segments, references, selected)
    mode = "逐段参考音色" if args.per_segment_reference else "固定角色音色"
    print(f"已准备{mode}：{len(references)} 个；方案：{role_plan}", flush=True)

    result_rows: list[dict] = []
    if not args.prepare_only:
        result_rows = generate_dubbing(args, segments, references, output_dir)
        result_csv = write_result_csv(output_dir, result_rows)
        print(f"已生成英文配音片段：{len(result_rows)} 个；清单：{result_csv}", flush=True)
    result_html = write_result_html(output_dir, segments, references, result_rows, args.model_id)
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
