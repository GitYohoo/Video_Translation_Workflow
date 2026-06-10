import path from "node:path";

export function createBsRoformerWorkflow({
  activeTasks,
  outputPaths,
  sourceFileStatus,
  getStatus,
  isFile,
  ensureDirectory,
  taskRunner,
  configuration,
}) {
  async function start(record) {
    const paths = outputPaths(record);
    if (!paths) {
      throw new Error("该项目没有原视频路径，无法执行二轨分离。");
    }
    const sourceStatus = await sourceFileStatus(record);
    if (!sourceStatus.ready) {
      throw new Error(sourceStatus.error);
    }
    if (activeTasks.get(record.id)?.status === "running") {
      return getStatus(record);
    }
    if (!(await isFile(configuration.coreScript))) {
      throw new Error(
        `找不到 BS-RoFormer 核心脚本：${configuration.coreScript}`,
      );
    }
    if (!(await isFile(configuration.pythonPath))) {
      throw new Error(`找不到 BS-RoFormer Python 环境：${configuration.pythonPath}`);
    }
    await ensureDirectory(configuration.temporaryDirectory);
    await taskRunner.start({
      videoId: record.id,
      workflow: "bs-roformer",
      logPath: path.join(configuration.logDirectory, `${record.id}_BS-RoFormer.log`),
      activeTasks,
      activeKey: record.id,
      command: configuration.pythonPath,
      arguments: [
        configuration.coreScript,
        "--video",
        record.sourcePath,
        "--runtime-dir",
        configuration.runtimeDirectory,
        "--output-root",
        paths.outputDirectory,
      ],
      spawnOptions: {
        cwd: configuration.workingDirectory,
        windowsHide: true,
        env: configuration.environment,
      },
    });
    return getStatus(record);
  }

  return { start };
}
