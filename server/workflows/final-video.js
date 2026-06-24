import path from "node:path";

export function createFinalVideoWorkflow({
  activeTasks,
  outputPaths,
  getDubbingStatus,
  getStatus,
  isFile,
  ensureDirectory,
  normalizeStyle,
  saveStyle,
  buildArguments,
  taskRunner,
  configuration,
}) {
  async function start(record, requestedStyle) {
    const paths = outputPaths(record);
    if (!paths) {
      throw new Error("该项目没有原视频路径，无法生成最终成片。");
    }
    const dubbingStatus = await getDubbingStatus(record);
    if (dubbingStatus.status !== "completed") {
      throw new Error(
        "英文译稿、主时间轴或音轨已变化，请先重新执行英文配音与混音。",
      );
    }
    const missingInputs = [];
    for (const inputPath of Object.values(paths.inputs)) {
      if (!(await isFile(inputPath))) {
        missingInputs.push(inputPath);
      }
    }
    if (missingInputs.length > 0) {
      throw new Error(`最终成片所需输入尚未齐全：${missingInputs.join("；")}`);
    }
    if (activeTasks.get(record.id)?.status === "running") {
      return getStatus(record);
    }
    for (const [label, filePath] of [
      ["视频成片脚本", configuration.coreScript],
      ["Python 环境", configuration.pythonPath],
      ["FFmpeg 程序", configuration.ffmpegPath],
    ]) {
      if (!(await isFile(filePath))) {
        throw new Error(`找不到${label}：${filePath}`);
      }
    }

    const style = normalizeStyle(requestedStyle);
    await saveStyle(record, style);
    await ensureDirectory(paths.outputDirectory);
    const processArguments = buildArguments(paths, style);
    await taskRunner.start({
      videoId: record.id,
      workflow: "final-video",
      logPath: path.join(
        configuration.logDirectory,
        `${record.id}_最终英文成片.log`,
      ),
      activeTasks,
      activeKey: record.id,
      command: configuration.pythonPath,
      arguments: processArguments,
      spawnOptions: {
        cwd: configuration.workingDirectory,
        windowsHide: true,
        env: configuration.environment,
      },
      failureMessage: (code) => `最终成片退出码：${code}`,
      startFailureMessage: (error) => `最终成片启动失败：${error.message}`,
    });
    return getStatus(record);
  }

  return { start };
}
