import { spawn } from "node:child_process";

export const videoFileDialogFilter =
  "视频文件 (*.mp4;*.mov;*.mkv;*.avi;*.wmv;*.flv;*.ts)|*.mp4;*.mov;*.mkv;*.avi;*.wmv;*.flv;*.ts|所有文件 (*.*)|*.*";

function powershellString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildVideoFileDialogScript() {
  return `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = ${powershellString("选择原视频文件")}
$dialog.Filter = ${powershellString(videoFileDialogFilter)}
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
}
`.trim();
}

export function parseSelectedVideoPath(output) {
  const selectedPath = output.trim();
  return selectedPath || null;
}

export function selectVideoPath() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        buildVideoFileDialogScript(),
      ],
      {
        windowsHide: false,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `文件选择窗口退出码：${code}`));
        return;
      }
      resolve(parseSelectedVideoPath(stdout));
    });
  });
}
