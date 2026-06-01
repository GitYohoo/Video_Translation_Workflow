$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ports = @(3001, 5173)
$currentProcessId = $PID
$blockedByOther = @()

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        $ownerId = [int]$connection.OwningProcess
        if ($ownerId -eq 0 -or $ownerId -eq $currentProcessId) {
            continue
        }

        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue
        $commandLine = if ($processInfo) { [string]$processInfo.CommandLine } else { "" }
        $processName = if ($processInfo) { [string]$processInfo.Name } else { "PID $ownerId" }
        $isWorkflowServer = $port -eq 3001 -and (
            $commandLine.Contains("server/index.js") -or
            $commandLine.Contains("server\index.js")
        )
        $isWorkflowVite = $port -eq 5173 -and $commandLine.Contains("vite")
        $belongsToThisProject =
            ($commandLine.Contains($projectRoot) -and ($isWorkflowServer -or $isWorkflowVite)) -or
            $isWorkflowServer -or
            $isWorkflowVite

        if ($belongsToThisProject) {
            Write-Host "清理旧开发进程：端口 $port / PID $ownerId / $processName"
            Stop-Process -Id $ownerId -Force
            continue
        }

        $blockedByOther += "端口 $port 被其他进程占用：PID $ownerId / $processName"
    }
}

if ($blockedByOther.Count -gt 0) {
    throw ($blockedByOther -join "`n")
}
