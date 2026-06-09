param(
  [string]$Python = "python",
  [string]$Venv = "D:\models\indextts2-venv"
)

$ErrorActionPreference = "Stop"

$modelRoot = "D:\models"
$tempRoot = "D:\Temp\VoxCPMRuntime"
$hfRoot = Join-Path $modelRoot "huggingface"
$hfHub = Join-Path $hfRoot "hub"
$modelScope = Join-Path $modelRoot "modelscope"
$torchHome = Join-Path $modelRoot "torch"
$pipCache = Join-Path $modelRoot "pip-cache"

New-Item -ItemType Directory -Force -Path $modelRoot, $tempRoot, $hfRoot, $hfHub, $modelScope, $torchHome, $pipCache | Out-Null

$env:HF_HOME = $hfRoot
$env:HF_HUB_CACHE = $hfHub
$env:HUGGINGFACE_HUB_CACHE = $hfHub
$env:MODELSCOPE_CACHE = $modelScope
$env:TORCH_HOME = $torchHome
$env:PIP_CACHE_DIR = $pipCache
$env:TEMP = $tempRoot
$env:TMP = $tempRoot

if (-not (Test-Path -LiteralPath (Join-Path $Venv "Scripts\python.exe"))) {
  & $Python -m venv $Venv
}

$venvPython = Join-Path $Venv "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip setuptools wheel
& $venvPython -m pip install voxcpm --upgrade-strategy only-if-needed --extra-index-url https://download.pytorch.org/whl/cu126 --trusted-host download.pytorch.org

Write-Host "VoxCPM Python environment:" $venvPython
Write-Host "Hugging Face cache directory:" $hfHub
