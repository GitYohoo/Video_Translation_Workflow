param(
  [string]$SourceDataDirectory = (Join-Path $PSScriptRoot "..\data"),
  [string]$DestinationDataDirectory = "D:\VideoTranslationWorkflow\data",
  [string]$RuntimeDirectory = (Join-Path $PSScriptRoot "..\.runtime")
)

$source = [System.IO.Path]::GetFullPath($SourceDataDirectory)
$destination = [System.IO.Path]::GetFullPath($DestinationDataDirectory)
$runtime = [System.IO.Path]::GetFullPath($RuntimeDirectory)

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "源数据目录不存在：$source"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDirectory = Join-Path $destination "migration-backup-$timestamp"
$backupCreated = $false

foreach ($fileName in @("videos.json", "settings.json")) {
  $sourceFile = Join-Path $source $fileName
  $destinationFile = Join-Path $destination $fileName
  if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    continue
  }
  if (Test-Path -LiteralPath $destinationFile -PathType Leaf) {
    if (-not $backupCreated) {
      New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
      $backupCreated = $true
    }
    Copy-Item -LiteralPath $destinationFile -Destination $backupDirectory -Force
  }
  Copy-Item -LiteralPath $sourceFile -Destination $destinationFile -Force
}

foreach ($directoryName in @("jobs", "logs", "thumbnails")) {
  $sourceDirectory = Join-Path $source $directoryName
  if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
    continue
  }
  $destinationDirectory = Join-Path $destination $directoryName
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Get-ChildItem -LiteralPath $sourceDirectory -Force | Copy-Item -Destination $destinationDirectory -Recurse -Force
}

$desktopSettingsPath = Join-Path $destination "desktop-settings.json"
if (-not (Test-Path -LiteralPath $desktopSettingsPath -PathType Leaf)) {
  $desktopSettings = [ordered]@{
    schemaVersion = 1
    dataDirectory = $destination
    runtimeDirectory = $runtime
  }
  [System.IO.File]::WriteAllText(
    $desktopSettingsPath,
    ($desktopSettings | ConvertTo-Json),
    [System.Text.UTF8Encoding]::new($false)
  )
}

Write-Output "桌面数据已准备：$destination"
Write-Output "运行环境目录：$runtime"
if ($backupCreated) {
  Write-Output "原目标配置备份：$backupDirectory"
}
