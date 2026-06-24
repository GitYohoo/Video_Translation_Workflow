# 🎬 影译工坊 / Video Translation Workshop

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.2.19-blue.svg?style=flat-square" alt="Version 0.2.19">
  <img src="https://img.shields.io/badge/Platform-Windows-0078d4.svg?style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/Electron-42.4.0-purple.svg?style=flat-square" alt="Electron 42.4.0">
  <img src="https://img.shields.io/badge/React-19.1.0-61dafb.svg?style=flat-square" alt="React 19.1.0">
  <img src="https://img.shields.io/badge/Express-5.1.0-green.svg?style=flat-square" alt="Express 5.1.0">
</p>

<p align="center">
  面向中文源视频的本地翻译、字幕校对、英文配音与成片导出桌面工作台。
  <br>
  A local-first desktop workbench for Chinese video translation, subtitle review, English dubbing, and final rendering.
</p>

> [!IMPORTANT]
> 项目目前主要面向 Windows 和 NVIDIA CUDA 环境，仍属于个人工作流工具，不是开箱即用的云服务。AI 模型、Python 环境、FFmpeg 和 Hugging Face 访问权限需要按本机环境配置。

## 项目能力

影译工坊把视频翻译制作拆分为可检查、可重试的本地任务：

1. 使用 BS-RoFormer 分离对白轨与背景音乐/音效轨。
2. 使用 PaddleOCR 从画面提取烧录中文字幕。
3. 使用 WhisperX 识别对白并标记说话人。
4. 合并、校对并保存最终中文字幕。
5. 生成 Gemini 翻译提示词，手动导入翻译与配音分段 JSON。
6. 使用 VoxCPM 合成英文配音，支持单条重新配音。
7. 混合英文对白与背景轨，烧录英文字幕并导出 MP4。
8. 支持按时间段微修最终成片。

主要任务由 Express 后端统一调度，React 界面展示状态，Electron 提供 Windows 桌面外壳。长任务状态、日志和生成产物会保留，应用重启后仍可检查。


## 隐私与联网边界

音频分离、OCR、说话人识别、配音和视频渲染默认在本机执行。以下操作可能联网：

- 首次安装 npm、Python 或模型依赖。
- 从 Hugging Face、ModelScope 等服务下载模型。
- 用户主动把中文字幕或提示词提交给 Gemini 进行翻译。

项目不会把 Hugging Face Token 写入源码。Token 应单独保存在本机文本文件中，仅在 `data/settings.json` 中配置文件路径。

## 环境要求

| 项目 | 建议 |
| --- | --- |
| 操作系统 | Windows 10/11 x64 |
| Node.js | 20 或更高版本；当前验证环境为 24.14.0 |
| Python | 3.10；当前验证环境为 3.10.11 |
| FFmpeg | 可从命令行调用，或由项目运行环境提供 |
| GPU | 建议使用支持 CUDA 的 NVIDIA GPU |
| 磁盘 | 建议准备容量充足的 D 盘存放模型、缓存、运行环境和视频产物 |
| 网络 | 安装依赖、下载模型和使用 Gemini 时需要 |

不同 AI 项目对 CUDA、PyTorch 和 Python 版本的要求可能不同。不要把所有模型强行安装到同一个 Python 环境中。

## 快速开始

### 1. 获取源码并安装 Node.js 依赖

```powershell
git clone https://github.com/GitYohoo/Video_Translation_Workflow.git
Set-Location Video_Translation_Workflow
npm install
```

依赖会安装到当前项目的 `node_modules`。仓库本身、模型和运行环境建议放在 D 盘，以减少 C 盘占用。

### 2. 创建本地运行配置

```powershell
Copy-Item data\settings.example.json data\settings.json
```

`data/settings.json` 已被 Git 忽略。默认示例：

```json
{
  "voxCpmPython": "D:\\models\\indextts2-venv\\Scripts\\python.exe",
  "voxCpmTempDirectory": "D:\\Temp\\VoxCPMRuntime",
  "whisperxTokenPath": "D:\\models\\huggingface\\token"
}
```

| 字段 | 用途 |
| --- | --- |
| `voxCpmPython` | VoxCPM 工作流使用的 Python 可执行文件 |
| `voxCpmTempDirectory` | 配音生成期间的临时目录 |
| `whisperxTokenPath` | 保存 Hugging Face Token 的本机文本文件路径 |

Token 文件只需要包含访问令牌本身。不要把 Token、`data/settings.json` 或 Token 文件复制到仓库。

### 3. 准备 VoxCPM 环境

项目提供了面向 D 盘的安装脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_voxcpm_runtime.ps1
```

脚本默认使用以下目录：

- Python 环境：`D:\models\indextts2-venv`
- Hugging Face 缓存：`D:\models\huggingface`
- PyTorch 缓存：`D:\models\torch`
- Pip 缓存：`D:\models\pip-cache`
- 临时目录：`D:\Temp\VoxCPMRuntime`

如果已有兼容环境，可跳过脚本并直接修改 `data/settings.json`。

### 4. 启动开发版

启动 Vite 前端和 Express 后端：

```powershell
npm run dev
```

浏览器访问 `http://127.0.0.1:5173/`。

### 5. 启动 Electron 桌面版

```powershell
npm run desktop
```

源码开发模式默认使用仓库内的 `data/` 和 `.runtime/`。打包后的桌面版默认把应用数据放在 `D:\VideoTranslationWorkflow\data`，大型运行环境放在 `D:\VideoTranslationWorkflow\runtime`。

## 使用流程

1. 在欢迎页选择原视频文件。
2. 明确点击开始，应用并行启动音轨分离与 OCR。
3. 对白轨就绪后运行 WhisperX，说话人字幕与 OCR 结果齐全后合并最终中文字幕。
4. 在中文字幕页面校对文本和角色。
5. 复制 Gemini 提示词，在外部完成翻译后，把 JSON 保存到界面指定位置并导入。
6. 检查英文字幕，启动 VoxCPM 配音；需要时输入分段编号进行单条重配音。
7. 调整英文字幕样式，生成并直接预览最终英文成片。

项目产物默认写在源视频所在目录附近，包括：

- `BS-RoFormer_二轨分离`
- `OCR_字幕校准`
- `最终中文字幕`
- `<视频名>_英文翻译字幕`
- 最终英文配音 MP4、ASS 字幕和结果报告

处理正式素材前，建议先用短视频验证环境和磁盘空间。

## 开发、测试与构建

```powershell
# Node.js 测试
npm run test:node

# Python 测试
python -m unittest discover -s tests -p "test_*.py" -v

# 前端生产构建
npm run build

# Electron 目录包
npm run desktop:pack

# Windows 安装版和便携版
npm run desktop:dist

# 完整发布流程：测试、构建、打包和产物验证
npm run release
```

`npm run release` 会清理仓库内已有的 `release/`，然后重新生成安装版和便携版。请勿把需要保留的文件手工放入该目录。

## 目录结构

```text
Video_Translation_Workflow/
├── build/              # 应用图标和 Electron 构建资源
├── data/               # 配置示例；本机设置、日志和任务数据不会提交
├── docs/               # 项目说明、设计和实施记录
├── electron/           # Electron 主进程、预加载脚本和桌面设置
├── scripts/            # Python 工作流及 PowerShell 打包/迁移脚本
├── server/             # Express API、任务系统和工作流适配器
├── src/                # React 前端
├── tests/              # Node.js 与 Python 自动化测试
├── package.json        # Node.js 依赖、脚本和桌面打包配置
└── README.md           # GitHub 项目首页
```

以下内容只应存在于本机，不应提交：

- `.env*`、私钥、证书、Token 和凭据文件
- `.claude/`、`.idea/`、`.vscode/` 等本机工具配置
- `data/settings.json`、`data/videos.json`、日志和任务状态
- `.runtime/`、模型权重、缓存、`node_modules/`
- 用户视频、音频、字幕以及生成成片
- `dist/` 和 `release/`

如果真实凭据曾经进入 Git 历史，仅删除当前文件不够：应立即吊销或轮换凭据，并在确认影响范围后清理历史。

## 常见问题

<details>
<summary><strong>应用提示找不到 Hugging Face Token</strong></summary>

确认 `whisperxTokenPath` 指向真实存在的文本文件，并且该 Token 已获得所需模型的访问权限。

</details>

<details>
<summary><strong>VoxCPM 或 WhisperX 无法启动</strong></summary>

检查配置的 Python 路径、CUDA/PyTorch 兼容性和模型缓存。先在对应虚拟环境中执行 `python --version` 与简单的 `import torch`，再从应用启动任务。

</details>

<details>
<summary><strong>端口 3001 或 5173 被占用</strong></summary>

`npm run dev` 会先运行端口清理脚本。若仍失败，请关闭遗留的 Node.js/Vite 进程后重试。

</details>

<details>
<summary><strong>没有 D 盘怎么办</strong></summary>

源码开发模式可使用仓库内的 `data/` 和 `.runtime/`。当前打包版默认按 D 盘目录设计；没有 D 盘时，需要在打包前调整桌面默认存储目录，或在后续版本中增加可选安装位置。

</details>

## 已知限制

- 当前自动化流程主要针对中文烧录字幕和英文配音场景。
- Gemini 翻译仍是人工复制提示词并导入 JSON，不是全自动 API 调用。
- AI 模型环境较大，首次安装和下载耗时取决于网络与磁盘性能。
- 桌面打包和运行路径目前优先针对 Windows 与 D 盘设计。
- 仓库当前未附带开源许可证；公开可见不代表自动获得复制、修改或再分发授权。
- 依赖更新后应重新运行 `npm audit`、完整测试、生产构建和桌面打包验证。

## 贡献前检查

提交变更前至少运行：

```powershell
npm run test:node
python -m unittest discover -s tests -p "test_*.py" -v
npm run build
git diff --check
```

同时检查 `git status --ignored --short`，确认没有把本机配置、凭据、视频素材、模型或发布产物加入 Git。
