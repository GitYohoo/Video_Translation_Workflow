$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$releaseDirectory = Join-Path $projectRoot "release"
$resourcesDirectory = Join-Path $releaseDirectory "win-unpacked\resources"
$unpackedDirectory = Join-Path $resourcesDirectory "app.asar.unpacked"

$requiredFiles = @(
  (Join-Path $resourcesDirectory "app.asar"),
  (Join-Path $unpackedDirectory "dist\index.html"),
  (Join-Path $unpackedDirectory "build\icon.png"),
  (Join-Path $unpackedDirectory "scripts\bs_roformer_refinement.py"),
  (Join-Path $unpackedDirectory "scripts\burned_subtitle_ocr.py"),
  (Join-Path $unpackedDirectory "scripts\setup_subtitle_ocr_runtime.ps1"),
  (Join-Path $unpackedDirectory "scripts\restore_ocr_punctuation.py"),
  (Join-Path $unpackedDirectory "scripts\whisperx_speaker_subtitles.py"),
  (Join-Path $unpackedDirectory "scripts\voxcpm_dubbing_workflow.py")
)

$version = $packageJson.version
function Expand-ArtifactName([string]$template) {
  return $template.Replace('${productName}', [string]$packageJson.productName).
    Replace('${version}', [string]$version).
    Replace('${arch}', 'x64').
    Replace('${ext}', 'exe')
}

$requiredArtifacts = @(
  (Join-Path $releaseDirectory (Expand-ArtifactName $packageJson.build.nsis.artifactName)),
  (Join-Path $releaseDirectory (Expand-ArtifactName $packageJson.build.portable.artifactName))
)

$missingFiles = @($requiredFiles + $requiredArtifacts | Where-Object {
  -not (Test-Path -LiteralPath $_ -PathType Leaf)
})

if ($missingFiles.Count -gt 0) {
  $formatted = $missingFiles | ForEach-Object { "  - $_" }
  throw "Desktop package is missing required files:`n$($formatted -join "`n")"
}

Write-Host "Desktop package verification passed for version $version."
