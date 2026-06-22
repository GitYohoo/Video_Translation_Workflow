$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$expectedReleaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))

if (-not $releaseDirectory.Equals(
    $expectedReleaseDirectory,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  throw "Refusing to clean an unexpected release directory: $releaseDirectory"
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$Step
  )

  Write-Host ""
  Write-Host "[$Step]" -ForegroundColor Cyan
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

function Stop-ReleaseProcesses {
  $releasePrefix = $releaseDirectory + [System.IO.Path]::DirectorySeparatorChar
  $releaseProcesses = @(
    Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith(
        $releasePrefix,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    }
  )
  foreach ($process in $releaseProcesses) {
    Write-Host "[Stop old release process] $($process.ProcessId) $($process.ExecutablePath)" -ForegroundColor Cyan
    Stop-Process -Id $process.ProcessId -Force
    Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  }
}

Push-Location $projectRoot
try {
  if (Test-Path -LiteralPath $releaseDirectory) {
    Write-Host "[Clean old release directory] $releaseDirectory" -ForegroundColor Cyan
    Stop-ReleaseProcesses
    Remove-Item -LiteralPath $releaseDirectory -Recurse -Force
  }

  Invoke-CheckedCommand "npm.cmd" @("run", "test:node") "Run Node tests"
  Invoke-CheckedCommand "python" @(
    "-m",
    "unittest",
    "discover",
    "-s",
    "tests",
    "-p",
    "test_*.py",
    "-v"
  ) "Run Python tests"
  Invoke-CheckedCommand "npm.cmd" @("run", "desktop:dist") "Build and verify desktop packages"

  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 |
    ConvertFrom-Json
  $version = [string]$packageJson.version
  function Expand-ArtifactName([string]$template) {
    return $template.Replace('${productName}', [string]$packageJson.productName).
      Replace('${version}', $version).
      Replace('${arch}', 'x64').
      Replace('${ext}', 'exe')
  }
  $expectedNames = @(
    (Expand-ArtifactName $packageJson.build.nsis.artifactName),
    (Expand-ArtifactName $packageJson.build.portable.artifactName)
  )
  $artifacts = @(
    Get-ChildItem -LiteralPath $releaseDirectory -File |
      Where-Object { $expectedNames -contains $_.Name } |
      Sort-Object Name
  )

  if ($artifacts.Count -ne 2) {
    throw "The installer and portable artifacts were not both found."
  }

  Write-Host ""
  Write-Host "Release package completed: v$version" -ForegroundColor Green
  $artifacts | ForEach-Object {
    Write-Host "  $($_.FullName)"
  }
} finally {
  Pop-Location
}
