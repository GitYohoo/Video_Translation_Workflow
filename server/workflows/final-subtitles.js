import path from "node:path";

export function createFinalSubtitlesWorkflow({
  activeTasks,
  outputPaths,
  getStatus,
  isFile,
  taskRunner,
  configuration,
}) {
  async function start(record) {
    const paths = outputPaths(record);
    if (!paths) {
      throw new Error("该项目没有原视频路径，无法合并最终中文字幕。");
    }
    const missingInputs = [];
    for (const inputPath of Object.values(paths.inputs)) {
      if (!(await isFile(inputPath))) {
        missingInputs.push(inputPath);
      }
    }
    if (missingInputs.length > 0) {
      throw new Error(`合并所需字幕尚未齐全：${missingInputs.join("；")}`);
    }
    if (activeTasks.get(record.id)?.status === "running") {
      return getStatus(record);
    }
    for (const [label, filePath] of [
      ["最终中文字幕合并脚本", configuration.coreScript],
      ["Python 环境", configuration.pythonPath],
    ]) {
      if (!(await isFile(filePath))) {
        throw new Error(`找不到${label}：${filePath}`);
      }
    }

    await taskRunner.start({
      videoId: record.id,
      workflow: "final-subtitles",
      logPath: path.join(
        configuration.logDirectory,
        `${record.id}_最终中文字幕.log`,
      ),
      activeTasks,
      activeKey: record.id,
      command: configuration.pythonPath,
      arguments: [
        configuration.coreScript,
        "--speaker-srt",
        paths.inputs.speakerSrt,
        "--ocr-srt",
        paths.inputs.ocrSrt,
        "--output-dir",
        paths.outputDirectory,
        "--video-stem",
        paths.videoStem,
      ],
      spawnOptions: {
        cwd: configuration.workingDirectory,
        windowsHide: true,
        env: configuration.environment,
      },
      failureMessage: (code) => `中文字幕合并退出码：${code}`,
      startFailureMessage: (error) =>
        `中文字幕合并启动失败：${error.message}`,
    });
    return getStatus(record);
  }

  return { start };
}
