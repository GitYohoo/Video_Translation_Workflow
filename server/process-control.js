import { spawn } from "node:child_process";

export async function terminateChildProcess(
  child,
  { platform = process.platform, spawnProcess = spawn } = {},
) {
  if (!child?.pid || child.exitCode !== null || child.killed) {
    return false;
  }
  if (platform !== "win32") {
    return child.kill("SIGTERM");
  }
  return new Promise((resolve, reject) => {
    const terminator = spawnProcess(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
    );
    terminator.on("error", reject);
    terminator.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`终止任务进程失败，taskkill 退出码：${code}`));
      }
    });
  });
}
