# Video Translation Workshop

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.2.37-blue.svg?style=flat-square" alt="Version 0.2.37">
  <img src="https://img.shields.io/badge/Platform-Windows-0078d4.svg?style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/License-Non--Commercial-orange.svg?style=flat-square" alt="Non-commercial research and learning license">
  <img src="https://img.shields.io/badge/Electron-42.4.0-purple.svg?style=flat-square" alt="Electron 42.4.0">
  <img src="https://img.shields.io/badge/React-19.1.0-61dafb.svg?style=flat-square" alt="React 19.1.0">
  <img src="https://img.shields.io/badge/Express-5.1.0-green.svg?style=flat-square" alt="Express 5.1.0">
</p>

<p align="center">
  Turn Chinese videos with burned-in subtitles into English-dubbed videos through a local,
  inspectable Windows workflow.
</p>

> [!IMPORTANT]
> This project is currently a personal local workflow tool, not a turnkey cloud service.
> It is designed primarily for Windows machines with an NVIDIA CUDA environment.
> AI model runtimes, Python environments, FFmpeg, and Hugging Face access must be configured locally.

## Why This Project Exists

Most video translation tools focus on one step: transcription, subtitle translation, text-to-speech, or rendering. Video Translation Workshop connects the full local pipeline for creators and developers who need to inspect every intermediate artifact before producing a final English-dubbed video.

It is built for workflows where privacy, retryability, and manual quality control matter more than one-click cloud automation.

## Who It Is For

- Creators localizing Chinese short dramas, clips, tutorials, or commentary videos into English.
- Developers experimenting with local AI dubbing pipelines built around WhisperX, PaddleOCR, VoxCPM, and FFmpeg.
- Teams that need a Windows desktop workflow where subtitles, speaker labels, dubbing segments, and final renders can be reviewed step by step.

This is probably not the right project if you need a hosted SaaS product, a fully automated translation API, or a lightweight command-line-only tool.

## Demo

| Original Video | Translated Result |
| :---: | :---: |
| [Watch original](https://youtu.be/eXMGXod8xZA?is=2jFKskscZBL4gBrq) | [Watch translated result](https://youtu.be/k0C39WoKOhY?is=9NcQgbUzsMdRNtyH) |
| [![Original video](https://img.youtube.com/vi/eXMGXod8xZA/0.jpg)](https://youtu.be/eXMGXod8xZA?is=2jFKskscZBL4gBrq) | [![Translated result](https://img.youtube.com/vi/k0C39WoKOhY/0.jpg)](https://youtu.be/k0C39WoKOhY?is=9NcQgbUzsMdRNtyH) |

## Highlights

- Local-first processing for source media and generated artifacts.
- End-to-end Chinese-to-English video localization workflow.
- OCR extraction for burned-in Chinese subtitles.
- WhisperX transcription and speaker labeling.
- Manual Gemini prompt workflow for controlled translation review.
- VoxCPM English dubbing with single-segment redubbing support.
- FFmpeg rendering with burned English subtitles and final MP4 export.
- Persistent job state, logs, and artifacts for long-running tasks.

## Fastest Way to Evaluate

If you only want to decide whether this project is worth installing:

1. Watch the demo videos above.
2. Read the [Typical Workflow](#typical-workflow) section to check whether the process matches your use case.
3. Confirm you have a Windows machine with enough D-drive space and preferably an NVIDIA CUDA GPU.
4. Run the development app with `npm run dev` before preparing every AI runtime.
5. Test with a short video before processing production material.

## What It Does

Video Translation Workshop breaks video localization into local, inspectable, and retryable tasks:

1. Separate dialogue and background music/effects tracks with BS-RoFormer.
2. Extract burned-in Chinese subtitles from video frames with PP-OCRv6.
3. Transcribe dialogue and identify speakers with WhisperX.
4. Merge OCR subtitles with speaker information, then review and edit final Chinese subtitles.
5. Generate Gemini translation prompts and manually import translation and dubbing-segment JSON.
6. Synthesize English dubbing with VoxCPM, including single-segment redubbing.
7. Mix English dialogue with the background track, burn English subtitles, and export MP4.
8. Fine-tune final video segments when small timing or rendering fixes are needed.

Long-running tasks are coordinated by an Express backend, displayed in a React frontend, and wrapped by Electron for the Windows desktop app. Job state, logs, and generated artifacts are kept so work can be inspected after restarting the app.

## Architecture

| Layer | Purpose |
| --- | --- |
| React + Vite | Browser UI for workflow status, subtitle review, prompt export, dubbing control, and final video preview |
| Express | Local API server, job state persistence, and Python workflow orchestration |
| Electron | Windows desktop shell, desktop storage paths, and packaging |
| Python scripts | OCR, ASR, speaker labeling, dubbing, audio mixing, validation, and FFmpeg rendering |

## Privacy and Network Boundary

Audio separation, OCR, speaker recognition, dubbing, and video rendering run locally by default.

Network access may happen when:

- Installing npm, Python, or model dependencies.
- Downloading models from Hugging Face, ModelScope, or related services.
- Manually submitting subtitles or prompts to Gemini for translation.

Hugging Face tokens should not be committed. Store token files locally and reference their paths in `data/settings.json`.

## Requirements

| Item | Recommendation |
| --- | --- |
| Operating system | Windows 10/11 x64 |
| Node.js | 20 or newer; current verified environment is 24.14.0 |
| Python | 3.10; current verified environment is 3.10.11 |
| FFmpeg | Available on PATH or provided by the configured runtime |
| GPU | NVIDIA GPU with CUDA support is strongly recommended |
| Disk | Use a large D drive for models, caches, runtimes, and video outputs when possible |
| Network | Required for dependency installation, model downloads, and Gemini usage |

Different AI projects may require different CUDA, PyTorch, and Python versions. Avoid forcing every model into a single Python environment.

## Quick Start

### 1. Clone the repository and install Node.js dependencies

```powershell
git clone https://github.com/GitYohoo/Video_Translation_Workflow.git
Set-Location Video_Translation_Workflow
npm install
```

Dependencies are installed into the local `node_modules` directory. The repository, model files, and runtime environments are best kept on the D drive to reduce C drive usage.

### 2. Create local runtime settings

```powershell
Copy-Item data\settings.example.json data\settings.json
```

`data/settings.json` is ignored by Git. Example:

```json
{
  "voxCpmPython": "D:\\models\\indextts2-venv\\Scripts\\python.exe",
  "voxCpmTempDirectory": "D:\\Temp\\VoxCPMRuntime",
  "whisperxTokenPath": "D:\\models\\huggingface\\token"
}
```

| Field | Purpose |
| --- | --- |
| `voxCpmPython` | Python executable used by the VoxCPM workflow |
| `voxCpmTempDirectory` | Temporary directory for dubbing generation |
| `whisperxTokenPath` | Local text file containing the Hugging Face token |

The token file should contain only the access token itself. Do not commit tokens, `data/settings.json`, or token files.

### 3. Prepare the PP-OCRv6 runtime

The OCR setup script installs PaddlePaddle GPU 3.3.1 and PaddleOCR 3.7.0 into the D-drive workspace runtime, then downloads and validates the PP-OCRv6 medium models. Existing PP-OCRv5 profiles remain available as fallbacks.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_subtitle_ocr_runtime.ps1
```

For the packaged desktop runtime, pass its runtime path explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_subtitle_ocr_runtime.ps1 `
  -Venv D:\VideoTranslationWorkflow\runtime\subtitle-ocr-venv
```

Models and package caches are stored under `D:\models`, while temporary files use `D:\Temp\SubtitleOCRRuntime`.

### 4. Prepare the VoxCPM runtime

The project includes a D-drive-oriented setup script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_voxcpm_runtime.ps1
```

Default paths used by the script:

- Python environment: `D:\models\indextts2-venv`
- Hugging Face cache: `D:\models\huggingface`
- PyTorch cache: `D:\models\torch`
- Pip cache: `D:\models\pip-cache`
- Temporary directory: `D:\Temp\VoxCPMRuntime`

If you already have a compatible runtime, skip the script and edit `data/settings.json` directly.

### 5. Start the development app

```powershell
npm run dev
```

Open `http://127.0.0.1:5173/` in a browser.

### 6. Start the Electron desktop app

```powershell
npm run desktop
```

In source development mode, the app uses the repository's `data/` and `.runtime/` directories. Packaged desktop builds default to `D:\VideoTranslationWorkflow\data` for app data and `D:\VideoTranslationWorkflow\runtime` for large runtime files.

## Typical Workflow

1. Select a source video on the welcome screen.
2. Explicitly start the workflow; audio separation and OCR run in parallel.
3. Run WhisperX after the dialogue track is ready.
4. Review and correct Chinese subtitles and speaker labels.
5. Copy the Gemini prompt, translate externally, save the returned JSON to the requested location, and import it.
6. Review English subtitles and run VoxCPM dubbing.
7. Redub individual segments when needed.
8. Adjust English subtitle styling, render the final video, and preview the result.

Generated artifacts are written near the source video by default, including:

- `BS-RoFormer_二轨分离`
- `OCR_字幕校准`
- `最终中文字幕`
- `<video-name>_英文翻译字幕`
- Final English-dubbed MP4 files, ASS subtitles, and result reports

Before processing production material, test with a short video to validate runtime paths, GPU availability, and free disk space.

## Development, Testing, and Packaging

```powershell
# Node.js tests
npm run test:node

# Python tests
python -m unittest discover -s tests -p "test_*.py" -v

# Frontend production build
npm run build

# Electron directory package
npm run desktop:pack

# Windows installer and portable package
npm run desktop:dist

# Full release workflow: tests, build, packaging, and artifact verification
npm run release
```

`npm run release` cleans the local `release/` directory and regenerates installer and portable artifacts. Do not manually place files there that must be preserved.

## Repository Layout

```text
Video_Translation_Workflow/
|-- build/              # App icons and Electron build resources
|-- data/               # Example config; local settings, logs, and job data are ignored
|-- docs/               # Project notes, design records, and implementation records
|-- electron/           # Electron main process, preload script, and desktop settings
|-- scripts/            # Python workflows and PowerShell packaging/migration scripts
|-- server/             # Express APIs, task system, and workflow adapters
|-- src/                # React frontend
|-- tests/              # Node.js and Python automated tests
|-- package.json        # Node.js dependencies, scripts, and desktop packaging config
`-- README.md           # GitHub repository homepage
```

## Discovery Keywords

People may find this project while searching for:

`video translation`, `AI dubbing`, `subtitle translation`, `Chinese to English dubbing`, `WhisperX`, `PaddleOCR`, `VoxCPM`, `FFmpeg video rendering`, `Electron desktop app`, `local video localization`, `burned-in subtitle OCR`, `AI voice dubbing`.

The following should stay local and should not be committed:

- `.env*`, private keys, certificates, tokens, and credential files
- `.claude/`, `.idea/`, `.vscode/`, and other local tool settings
- `data/settings.json`, `data/videos.json`, logs, and job state
- `.runtime/`, model weights, caches, and `node_modules/`
- User videos, audio files, subtitles, and generated final videos
- `dist/` and `release/`

If real credentials were committed to Git history, deleting the current files is not enough. Revoke or rotate the credentials immediately, then clean the history after confirming the affected scope.

## FAQ

<details>
<summary><strong>The app cannot find my Hugging Face token</strong></summary>

Check that `whisperxTokenPath` points to a real text file and that the token has access to the required models.

</details>

<details>
<summary><strong>VoxCPM or WhisperX does not start</strong></summary>

Check the configured Python path, CUDA/PyTorch compatibility, and model cache. First run `python --version` and a simple `import torch` test inside the matching virtual environment, then start the workflow from the app.

</details>

<details>
<summary><strong>Port 3001 or 5173 is already in use</strong></summary>

`npm run dev` runs the port cleanup script first. If startup still fails, close old Node.js or Vite processes and try again.

</details>

<details>
<summary><strong>What if the machine does not have a D drive?</strong></summary>

Source development mode can use the repository's `data/` and `.runtime/` directories. Current packaged builds are designed around D-drive storage by default. Without a D drive, adjust desktop storage defaults before packaging or add configurable install/runtime paths in a future version.

</details>

## License

This project is released under a custom non-commercial research and learning license.

You may use, study, modify, and share it for non-commercial learning, research, evaluation, and personal experimentation. Commercial use, paid services, commercial bundling, sublicensing, or monetization require separate written permission from the copyright holder.

See [LICENSE](LICENSE) for the full terms.

## Known Limitations

- The automated workflow currently targets Chinese burned-in subtitles and English dubbing.
- Gemini translation is still a manual prompt-copy and JSON-import workflow, not a fully automated API integration.
- AI model environments are large; first-time setup depends heavily on network speed and disk performance.
- Desktop packaging and runtime paths are currently optimized for Windows and D-drive storage.
- Dependency updates should be followed by `npm audit`, full tests, production build, and desktop package verification.

## Pre-Commit Checks

Run at least:

```powershell
npm run test:node
python -m unittest discover -s tests -p "test_*.py" -v
npm run build
git diff --check
```

Also inspect `git status --ignored --short` before committing to ensure local settings, credentials, source media, generated outputs, models, caches, and release artifacts are not included.
