from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from huggingface_hub import hf_hub_download


ASSETS = [
    ("facebook/w2v-bert-2.0", "config.json", "W2v-BERT 配置"),
    ("facebook/w2v-bert-2.0", "preprocessor_config.json", "W2v-BERT 预处理配置"),
    ("facebook/w2v-bert-2.0", "model.safetensors", "W2v-BERT 权重（约 2.32 GB）"),
    ("amphion/MaskGCT", "semantic_codec/model.safetensors", "MaskGCT semantic codec（约 177 MB）"),
    ("funasr/campplus", "campplus_cn_common.bin", "CampPlus"),
    ("nvidia/bigvgan_v2_22khz_80band_256x", "config.json", "BigVGAN 配置"),
    ("nvidia/bigvgan_v2_22khz_80band_256x", "bigvgan_generator.pt", "BigVGAN 权重"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="预缓存 IndexTTS2 运行时模型资源。")
    parser.add_argument(
        "--cache-dir",
        default=os.environ.get(
            "HF_HUB_CACHE",
            os.environ.get("HUGGINGFACE_HUB_CACHE", r"D:\models\huggingface\hub"),
        ),
        help="Hugging Face Hub 缓存目录",
    )
    parser.add_argument("--state-file", help="下载状态 JSON 路径")
    parser.add_argument("--max-retries", type=int, default=3, help="每个资源最大下载尝试次数")
    parser.add_argument("--retry-delay", type=int, default=10, help="重试前等待秒数")
    parser.add_argument("--local-files-only", action="store_true", help="只校验本地缓存，不访问网络")
    return parser.parse_args()


def write_state(path: Path | None, state: dict) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def stamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def main() -> int:
    args = parse_args()
    if args.max_retries < 1:
        raise ValueError("--max-retries 必须大于等于 1。")
    cache_dir = Path(args.cache_dir).resolve()
    state_file = Path(args.state_file).resolve() if args.state_file else None
    cache_dir.mkdir(parents=True, exist_ok=True)
    print(f"IndexTTS2 额外资源缓存目录：{cache_dir}", flush=True)
    state = {
        "缓存目录": str(cache_dir),
        "仅本地校验": args.local_files_only,
        "更新时间": stamp(),
        "资源": {},
    }
    write_state(state_file, state)
    for index, (repo_id, filename, label) in enumerate(ASSETS, start=1):
        asset_key = f"{repo_id}/{filename}"
        for attempt in range(1, args.max_retries + 1):
            state["更新时间"] = stamp()
            state["资源"][asset_key] = {"状态": "进行中", "尝试": attempt, "说明": label}
            write_state(state_file, state)
            print(
                f"[{index}/{len(ASSETS)}] {label}：{repo_id}/{filename}（尝试 {attempt}/{args.max_retries}）",
                flush=True,
            )
            try:
                downloaded = hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    cache_dir=str(cache_dir),
                    local_files_only=args.local_files_only,
                )
                size = Path(downloaded).stat().st_size
                state["资源"][asset_key] = {
                    "状态": "完成",
                    "说明": label,
                    "本地文件": downloaded,
                    "大小字节": size,
                }
                state["更新时间"] = stamp()
                write_state(state_file, state)
                print(f"已完成 {label}：{downloaded}（{size / 1024 / 1024:.1f} MB）", flush=True)
                break
            except Exception as error:
                state["资源"][asset_key] = {
                    "状态": "失败",
                    "说明": label,
                    "尝试": attempt,
                    "错误": str(error),
                }
                state["更新时间"] = stamp()
                write_state(state_file, state)
                if attempt >= args.max_retries:
                    raise
                print(f"下载失败，将在 {args.retry_delay} 秒后断点重试：{error}", flush=True)
                time.sleep(args.retry_delay)
    print(f"IndexTTS2 运行时资源已全部就绪；状态：{state_file or '未指定'}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"资源缓存失败：{error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
