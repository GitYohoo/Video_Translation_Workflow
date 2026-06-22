# 🎬 影译工坊 - Video Translation Workshop

面向本地视频翻译制作流程的端到端自动化桌面工作台  
*An end-to-end automated desktop workbench for local video translation and post-production workflows.*

---

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.2.14-blue.svg?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Electron-42.4.0-purple.svg?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/React-19.1.0-61dafb.svg?style=flat-square" alt="React">
  <img src="https://img.shields.io/badge/Express-5.1.0-green.svg?style=flat-square" alt="Express">
  <img src="https://img.shields.io/badge/Python-AI%2FML-blueviolet.svg?style=flat-square" alt="Python">
</p>

---

## 📖 关于项目 / About The Project

<details open>
<summary>🇨🇳 <b>中文介绍</b></summary>
<br>

**影译工坊 (Video Translation Workshop)** 是一款专为本地化音视频翻译设计的桌面应用程序。它整合了尖端的 AI 语音与多媒体技术，实现了从“中文源视频”到“带英文字幕与角色配音的高质量成品视频”的完整闭环，极大地简化了复杂的视频翻译制作工序。

</details>

<details open>
<summary>🇺🇸 <b>English Description</b></summary>
<br>

**Video Translation Workshop (影译工坊)** is a comprehensive desktop application tailored for local audio and video translation workflows. Integrating cutting-edge AI speech and multimedia technologies, it automates the transition from a Chinese source video to a high-quality finished video with English subtitles and character-matching voiceovers.

</details>

---

## ✨ 核心特性 / Core Features

<table>
  <thead>
    <tr>
      <th width="50%">🇨🇳 核心特性</th>
      <th width="50%">🇺🇸 Core Features</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <b>🚀 端到端自动化</b><br>
        一键即可运行完整工作流：原视频导入、音频分离、字幕提取，到配音规划、人声合成和最终渲染。
      </td>
      <td>
        <b>🚀 End-to-End Automation</b><br>
        Run the entire workflow seamlessly: video import, audio separation, subtitle extraction, dubbing planning, voice synthesis, and final rendering.
      </td>
    </tr>
    <tr>
      <td>
        <b>🎙️ 角色音色固定</b><br>
        集成 VoxCPM2 与 IndexTTS2 等 AI 语音合成引擎，自动识别视频中的不同角色并匹配固定音色，确保配音一致性。
      </td>
      <td>
        <b>🎙️ Consistent Voice Matching</b><br>
        Integrates advanced AI speech synthesis engines like VoxCPM2 and IndexTTS2, automatically identifying speakers and locking character voices.
      </td>
    </tr>
    <tr>
      <td>
        <b>🧩 智能句群规划</b><br>
        基于 Google Gemini API 进行智能翻译，能够针对英语表达习惯进行“显示字幕”和“配音断句建议”的解耦规划。
      </td>
      <td>
        <b>🧩 Smart Dubbing Planning</b><br>
        Leverages Google Gemini API to translate subtitles and decouple "display subtitles" from "dubbing audio segment planning" for natural output.
      </td>
    </tr>
    <tr>
      <td>
        <b>🎛️ 可视化字幕编辑器</b><br>
        内置 React 驱动的交互式 Web 界面，支持用户实时校对字幕、调整时间轴，并能灵活拖拽调整字幕在画面中的位置。
      </td>
      <td>
        <b>🎛️ Visual Subtitle Editor</b><br>
        Built-in React-powered editor allowing real-time calibration of subtitles, timelines, and drag-and-drop subtitle positioning on the video.
      </td>
    </tr>
    <tr>
      <td>
        <b>🛡️ 全本地隐私安全</b><br>
        多媒体分析和 AI 推理均运行在本地 Python 虚拟环境中，保护企业及个人视频素材的隐私安全性。
      </td>
      <td>
        <b>🛡️ Privacy & Local Processing</b><br>
        Heavy multimedia analysis and AI inferences run entirely within local Python virtual environments, protecting your video source materials.
      </td>
    </tr>
    <tr>
      <td>
        <b>📦 便携性与自动打包</b><br>
        支持通过 Electron 跨平台封装，并提供自动化发布脚本，可一键将应用打包为独立便携版本（Portable），解压即用。
      </td>
      <td>
        <b>📦 Desktop & Portability</b><br>
        Wrapped inside Electron, featuring a fully automated build script that outputs ready-to-run portable versions for distribution.
      </td>
    </tr>
  </tbody>
</table>

---

## 🎬 自动化工作流步骤 / Automated Workflow Steps

<details>
<summary>🇨🇳 <b>查看工作流详情 (中文)</b></summary>
<br>

1. **音频分离 (BS-RoFormer)**
   * 提取原视频的音频轨，使用 AI 模型精细分离出对白音轨 (DX) 和背景声效底轨 (MX+FX)。
   * *技术栈*: `BS-RoFormer` | `FFmpeg` | `PyTorch`
2. **字幕提取 (PaddleOCR)**
   * 通过图像文字识别（OCR）从视频底部的画面中精准获取已烧录的中文字幕，并生成带时间戳的 SRT 文件。
   * *技术栈*: `PaddleOCR` | `OpenCV`
3. **说话人识别 (WhisperX)**
   * 利用 Whisper 语音识别与说话人日志技术，给不同语音片段打上角色标签（如 Speaker_0）。
   * *技术栈*: `WhisperX` | `PyTorch` | `ASR`
4. **英文翻译与规划 (Gemini API)**
   * 调用 Gemini 智能生成高质量英文翻译，并输出专为配音节奏适配的语句分段规划 JSON 数据。
   * *技术栈*: `Google Gemini` | `LLM API`
5. **英文配音合成 (VoxCPM2 / IndexTTS2)**
   * 根据规划好的说话人标签与时长，通过本地多角色 TTS 系统合成对应的英文配音音频段。
   * *技术栈*: `VoxCPM2` | `IndexTTS2` | `CUDA`
6. **混音渲染 (FFmpeg)**
   * 合并分离的背景底噪轨 (MX+FX) 与新合成的英文配音轨，并将英文字幕烧录到视频画面上，生成成品视频。
   * *技术栈*: `FFmpeg` | `librosa`

</details>

<details>
<summary>🇺🇸 <b>View Workflow Steps (English)</b></summary>
<br>

1. **Vocal/BGM Separation (BS-RoFormer)**
   * Extracts the original audio track, separating vocal dialog (DX) from background music and sound effects (MX+FX) using neural models.
   * *Tech*: `BS-RoFormer` | `FFmpeg` | `PyTorch`
2. **Subtitle OCR Extraction (PaddleOCR)**
   * Extracts hardcoded Chinese subtitles directly from video frames utilizing optical character recognition to generate timestamped SRT files.
   * *Tech*: `PaddleOCR` | `OpenCV`
3. **Diarization & ASR (WhisperX)**
   * Uses Whisper speech-to-text combined with voice diarization to assign speaker tags (e.g., Speaker_0) to dialogue lines.
   * *Tech*: `WhisperX` | `PyTorch` | `ASR`
4. **Translation & Dubbing Planning (Gemini)**
   * Invokes Google Gemini to generate high-quality translation and structural planning data tailored for dubbing cadences.
   * *Tech*: `Google Gemini` | `LLM API`
5. **AI Voice Synthesis (VoxCPM2 / IndexTTS2)**
   * Synthesizes distinct character voiceovers matching the identified speakers and temporal constraints using local AI TTS engines.
   * *Tech*: `VoxCPM2` | `IndexTTS2` | `CUDA`
6. **Video Rendering (FFmpeg)**
   * Mixes synthesized English dubbing tracks with original BGM tracks, burns in the translated subtitles, and outputs the final video.
   * *Tech*: `FFmpeg` | `librosa`

</details>

---

## 📂 目录结构 / Directory Structure

```text
Video_Translation_Workflow/
├── .runtime/                   # 本地 Python 虚拟环境与 AI 权重模型 / Local Python Venvs & Model Weights
│   ├── bs-roformer-models/      # 音声分离模型 / BS-RoFormer models
│   ├── ffmpeg/                  # 静态 FFmpeg 工具包 / FFmpeg binary executables
│   └── whisperx-models/         # 语音听写与说话人模型 / WhisperX model weights
├── data/                        # 运行时生成数据与配置文件 / Live databases & log structures
│   ├── logs/                    # 系统执行日志 / App backend logger directories
│   └── videos.json              # 视频项目管理元数据 / Video project registry manifest
├── docs/                        # 详细设计、规范与概览文档 / Specs, developer documentation & HTML plans
├── electron/                    # Electron 桌面外壳及初始化导航逻辑 / Electron main shell & routing scripts
├── scripts/                     # Python 工作流核心脚本与打包脚本 / Core Python processors & deployment scripts
│   ├── burned_subtitle_ocr.py   # 视频烧录字幕提取 / Video frame hardcode subtitle OCR
│   ├── voxcpm_dubbing_workflow.py# VoxCPM 配音管线 / VoxCPM TTS generation module
│   └── package_release.ps1      # 一键自动化发布打包脚本 / Automated release script
├── server/                      # Express.js REST API 服务端 / Express backend codebase
├── src/                         # React 前端交互界面 / React UI client codebase
├── package.json                 # 依赖管理与构建运行脚本配置 / Project dependencies & build instructions
└── README.md                    # 双语项目文档 / Bilingual documentation portal
```

---

## 🚀 快速开始 / Getting Started

<details open>
<summary>🇨🇳 <b>快速开始 (中文)</b></summary>
<br>

### 1. 安装 Node 依赖
```bash
npm install
```

### 2. 启动开发服务器
验证开发端口占用情况，同时启动 Vite 前端热更新与 Express 后端 API 服务：
```bash
npm run dev
```

### 3. 启动 Electron 桌面版 (开发调试)
```bash
npm run desktop
```

### 4. 打包发布应用
进行自动代码编译、Electron 便携版打包、路径补丁与资源校验：
```bash
npm run release
```

</details>

<details>
<summary>🇺🇸 <b>Getting Started (English)</b></summary>
<br>

### 1. Install Node Dependencies
```bash
npm install
```

### 2. Start Development Servers
Checks port availability and concurrently spins up the Vite frontend and Express server:
```bash
npm run dev
```

### 3. Start Electron App (Development)
```bash
npm run desktop
```

### 4. Production Packaging
Build Vite assets, pack the Electron bundle, apply path patches, and verify the output package:
```bash
npm run release
```

</details>

---

## 🔌 常用后端 API / Common Backend APIs

| 请求方式 / Method | 接口路径 / Path | 说明 / Description |
| :--- | :--- | :--- |
| `GET` | `/api/videos` | 获取当前工作视频项目列表 / Retrieve lists of registered video translation projects |
| `POST` | `/api/videos` | 导入或上传新视频项目 / Import or upload new video resource and create state |
| `POST` | `/api/videos/:id/workflow/ocr-subtitles` | 调度 Python 子进程启动视频硬字幕 OCR 识别 / Spawn Python sub-process to extract subtitles via PaddleOCR |
| `POST` | `/api/videos/:id/workflow/english-dubbing` | 触发英文翻译与 AI 多角色音色配音合成 / Trigger Gemini translation & local AI dubbing pipeline |
| `POST` | `/api/videos/:id/workflow/final-video` | 利用 FFmpeg 烧录字幕及合成音频渲染出最终成品 / Run FFmpeg compilation to render final dubbed/subtitled video |
| `GET` | `/api/videos/:id/workflow/status` | 轮询任务的实时执行状态与日志反馈 / Fetch real-time process monitoring logs and worker state |

---

> 影译工坊 - 智能视频翻译工作台 | Powered by Ying Yi Gong Fang
