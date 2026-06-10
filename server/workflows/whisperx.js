import path from "node:path";

export function createWhisperxWorkflow({
  activeTasks,
  outputPaths,
  getStatus,
  isFile,
  ensureDirectory,
  taskRunner,
  configuration,
}) {
  async function start(record) {
    const paths = outputPaths(record);
    if (!paths) {
      throw new Error("该项目没有原视频路径，无法执行 WhisperX。");
    }
    if (!(await isFile(paths.inputPath))) {
      throw new Error("未生成 DX 对白轨，请先完成 BS-RoFormer 二轨分离。");
    }
    if (activeTasks.get(record.id)?.status === "running") {
      return getStatus(record);
    }
    for (const [label, filePath] of [
      ["WhisperX 脚本", configuration.coreScript],
      ["WhisperX Python 环境", configuration.pythonPath],
      ["Hugging Face 访问令牌", configuration.tokenPath],
      ["FFmpeg 程序", configuration.ffmpegPath],
    ]) {
      if (!(await isFile(filePath))) {
        throw new Error(`找不到${label}：${filePath}`);
      }
    }

    await ensureDirectory(configuration.temporaryDirectory);
    await ensureDirectory(configuration.modelDirectory);
    await taskRunner.start({
      videoId: record.id,
      workflow: "whisperx-speakers",
      logPath: path.join(
        configuration.logDirectory,
        `${record.id}_WhisperX_说话人字幕.log`,
      ),
      activeTasks,
      activeKey: record.id,
      command: configuration.pythonPath,
      arguments: [
        configuration.coreScript,
        "--audio",
        paths.inputPath,
        "--runtime-dir",
        configuration.runtimeDirectory,
        "--token-file",
        configuration.tokenPath,
        "--model",
        "large-v3",
        "--batch-size",
        "4",
      ],
      spawnOptions: {
        cwd: configuration.workingDirectory,
        windowsHide: true,
        env: configuration.environment,
      },
      failureMessage: (code) => `WhisperX 处理退出码：${code}`,
      startFailureMessage: (error) => `WhisperX 启动失败：${error.message}`,
    });
    return getStatus(record);
  }

  return { start };
}
