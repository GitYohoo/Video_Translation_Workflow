const stoppedStatuses = new Set(["failed", "cancelled", "unavailable"]);

function hasStoppedTask(input) {
  return [input.separation, input.ocr, input.speakers, input.finalSubtitles].some(
    (task) => stoppedStatuses.has(task?.status),
  );
}

export function nextAutomaticActions(input = {}) {
  if (
    !input.started ||
    input.storageMode !== "reference" ||
    input.finalSubtitles?.status === "completed" ||
    hasStoppedTask(input)
  ) {
    return [];
  }

  const actions = [];
  if (input.separation?.status === "ready") {
    actions.push("separation");
  }
  if (input.ocr?.status === "ready") {
    actions.push("ocr");
  }
  if (input.speakers?.status === "ready" && input.speakers.canRun) {
    actions.push("speakers");
  }
  if (input.finalSubtitles?.status === "ready" && input.finalSubtitles.canRun) {
    actions.push("finalSubtitles");
  }
  return actions;
}

export function summarizeAutomaticWorkflow(input = {}) {
  if (input.finalSubtitles?.status === "completed") {
    return {
      state: "completed",
      title: "最终中文字幕已生成",
      detail: "可以播放视频并在下方直接更正字幕。",
      percent: 100,
    };
  }

  const failedTask = [input.separation, input.ocr, input.speakers, input.finalSubtitles].find(
    (task) => stoppedStatuses.has(task?.status),
  );
  if (failedTask) {
    return {
      state: "failed",
      title: failedTask.status === "cancelled" ? "自动流程已取消" : "自动流程需要处理",
      detail: failedTask.error || "检查运行环境后重试自动流程。",
      percent: 0,
    };
  }
  if (!input.started) {
    return {
      state: "ready",
      title: "准备生成最终中文字幕",
      detail: "点击开始后，将自动连续执行到最终中文字幕。",
      percent: 0,
    };
  }
  if (input.finalSubtitles?.status === "running") {
    return { state: "running", title: "正在生成最终中文字幕", detail: "正在合并正文与说话人标记。", percent: 90 };
  }
  if (input.speakers?.status === "running") {
    return { state: "running", title: "正在识别说话人", detail: "完成后会自动生成最终中文字幕。", percent: 65 };
  }
  if (input.ocr?.status === "running" || input.separation?.status === "running") {
    return { state: "running", title: "正在准备字幕素材", detail: "音轨分离与画面字幕提取正在自动执行。", percent: 30 };
  }
  return { state: "ready", title: "正在启动字幕流程", detail: "任务启动后会自动连续执行。", percent: 5 };
}

export function hasAutomaticWorkflowProgress(input = {}) {
  return [input.separation, input.ocr, input.speakers, input.finalSubtitles].some(
    (task) => task && !["ready", "blocked", "unavailable"].includes(task.status),
  );
}
