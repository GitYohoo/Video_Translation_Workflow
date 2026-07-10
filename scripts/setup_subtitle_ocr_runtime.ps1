param(
  [string]$Python = "python",
  [string]$Venv = "",
  [switch]$SkipModelDownload
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $Venv) {
  $Venv = Join-Path $projectRoot ".runtime\subtitle-ocr-venv"
}
$Venv = [System.IO.Path]::GetFullPath($Venv)

$modelRoot = "D:\models"
$paddleCache = Join-Path $modelRoot "paddle"
$pipCache = Join-Path $modelRoot "pip-cache"
$tempRoot = "D:\Temp\SubtitleOCRRuntime"
$paddleIndex = "https://www.paddlepaddle.org.cn/packages/stable/cu126/"

New-Item -ItemType Directory -Force -Path $modelRoot, $paddleCache, $pipCache, $tempRoot | Out-Null

$env:PADDLE_PDX_CACHE_HOME = $paddleCache
$env:PADDLEX_HOME = $paddleCache
$env:PADDLE_HOME = $paddleCache
$env:MODEL_HOME = $paddleCache
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "True"
$env:PIP_CACHE_DIR = $pipCache
$env:TEMP = $tempRoot
$env:TMP = $tempRoot
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

if (-not (Test-Path -LiteralPath (Join-Path $Venv "Scripts\python.exe"))) {
  & $Python -m venv $Venv
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create the subtitle OCR virtual environment."
  }
}

$venvPython = Join-Path $Venv "Scripts\python.exe"

& $venvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) {
  throw "Failed to update pip tooling."
}

& $venvPython -m pip install "paddlepaddle-gpu==3.3.1" `
  --extra-index-url $paddleIndex `
  --trusted-host "www.paddlepaddle.org.cn"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install PaddlePaddle GPU 3.3.1."
}

& $venvPython -m pip install --upgrade "paddleocr==3.7.0"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install PaddleOCR 3.7.0."
}

if (-not $SkipModelDownload) {
  $validationScript = @'
from importlib.metadata import version
from paddleocr import PaddleOCR

ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv6_medium_det",
    text_recognition_model_name="PP-OCRv6_medium_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    device="gpu:0",
)
print(f"PaddleOCR {version('paddleocr')} ready with PP-OCRv6 medium models: {type(ocr).__name__}")
'@
  $validationPath = Join-Path $tempRoot "validate_pp_ocr_v6.py"
  try {
    [System.IO.File]::WriteAllText(
      $validationPath,
      $validationScript,
      [System.Text.UTF8Encoding]::new($false)
    )
    & $venvPython $validationPath
    if ($LASTEXITCODE -ne 0) {
      throw "PP-OCRv6 model initialization failed."
    }
  }
  finally {
    if (Test-Path -LiteralPath $validationPath) {
      Remove-Item -LiteralPath $validationPath -Force
    }
  }
}

Write-Host "Subtitle OCR Python environment:" $venvPython
Write-Host "Paddle model cache directory:" $paddleCache
