import path from "node:path";

function numericTime(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label}必须是有效数字。`);
  }
  if (number < 0) {
    throw new Error(`${label}时间不能小于 0。`);
  }
  return Math.round(number * 1000) / 1000;
}

export function normalizeValidationRanges(ranges = []) {
  if (!Array.isArray(ranges)) {
    throw new Error("时间段必须是数组。");
  }
  const normalized = ranges
    .map((range, index) => {
      const start = numericTime(range?.start, `第 ${index + 1} 个开始`);
      const end = numericTime(range?.end, `第 ${index + 1} 个结束`);
      if (end <= start) {
        throw new Error(`第 ${index + 1} 个时间段的结束时间必须晚于开始时间。`);
      }
      return { start, end };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  return normalized.reduce((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }
    merged.push({ ...range });
    return merged;
  }, []);
}

export function normalizeValidationConfiguration(value = {}) {
  return {
    sourceAudioRanges: normalizeValidationRanges(value.sourceAudioRanges || []),
    mutedBackgroundRanges: normalizeValidationRanges(value.mutedBackgroundRanges || []),
  };
}

export function createFinalValidationWorkflow({
  activeTasks,
  outputPaths,
  getFinalVideoStatus,
  getStatus,
  isFile,
  ensureDirectory,
  saveConfiguration,
  buildArguments,
  taskRunner,
  configuration,
}) {
  async function start(record, requestedConfiguration = {}) {
    const paths = outputPaths(record);
    if (!paths) {
      throw new Error("该项目没有原视频路径，无法执行最终验证。");
    }
    const finalVideoStatus = await getFinalVideoStatus(record);
    if (finalVideoStatus.status !== "completed") {
      throw new Error("请先完成导出成片，再执行最终验证。");
    }
    const missingInputs = [];
    for (const inputPath of Object.values(paths.inputs)) {
      if (!(await isFile(inputPath))) {
        missingInputs.push(inputPath);
      }
    }
    if (missingInputs.length > 0) {
      throw new Error(`最终验证所需输入尚未齐全：${missingInputs.join("；")}`);
    }
    if (activeTasks.get(record.id)?.status === "running") {
      return getStatus(record);
    }
    for (const [label, filePath] of [
      ["最终验证脚本", configuration.coreScript],
      ["Python 环境", configuration.pythonPath],
      ["FFmpeg 程序", configuration.ffmpegPath],
    ]) {
      if (!(await isFile(filePath))) {
        throw new Error(`找不到${label}：${filePath}`);
      }
    }

    const normalized = normalizeValidationConfiguration(requestedConfiguration);
    await ensureDirectory(paths.outputDirectory);
    await saveConfiguration(paths.configPath, normalized);
    await taskRunner.start({
      videoId: record.id,
      workflow: "final-validation",
      logPath: path.join(configuration.logDirectory, `${record.id}_最终验证.log`),
      activeTasks,
      activeKey: record.id,
      command: configuration.pythonPath,
      arguments: buildArguments(paths),
      spawnOptions: {
        cwd: configuration.workingDirectory,
        windowsHide: true,
        env: configuration.environment,
      },
      failureMessage: (code) => `最终验证退出码：${code}`,
      startFailureMessage: (error) => `最终验证启动失败：${error.message}`,
    });
    return getStatus(record);
  }

  return { start };
}
