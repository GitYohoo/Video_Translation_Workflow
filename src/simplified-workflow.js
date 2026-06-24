const stoppedStatuses = new Set(["failed", "cancelled", "unavailable"]);
const completedStatuses = new Set(["completed"]);
const readyStatuses = new Set(["ready", "failed"]);

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
      detail: "可以进入校正中文字幕步骤，边播放边更正字幕。",
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

function statusOrBlocked(task, fallbackReady) {
  if (task?.status) {
    return task.status;
  }
  return fallbackReady ? "ready" : "blocked";
}

function labelForSimplifiedStep(step, state, input) {
  if (state === "completed") {
    return step.completedLabel;
  }
  if (state === "running") {
    return step.runningLabel;
  }
  if (state === "ready" || state === "failed") {
    return step.readyLabel;
  }
  return step.blockedLabel;
}

function generationState(input) {
  if (input.finalSubtitles?.outputs?.srt?.ready || input.finalSubtitles?.status === "completed") {
    return "completed";
  }
  if (hasStoppedTask(input)) {
    return "failed";
  }
  if (
    input.started &&
    [input.separation, input.ocr, input.speakers, input.finalSubtitles].some(
      (task) => task?.status === "running",
    )
  ) {
    return "running";
  }
  if (input.storageMode && input.storageMode !== "reference") {
    return "blocked";
  }
  return "ready";
}

export function buildSimplifiedWorkflowOverview(input = {}) {
  const canTranslate = Boolean(input.finalSubtitles?.outputs?.srt?.ready || input.finalSubtitles?.status === "completed");
  const hasDubbingProgress = ["running", "completed"].includes(input.englishDubbing?.status);
  const hasFinalVideoProgress = ["running", "completed"].includes(input.finalVideo?.status);
  const hasFinalValidationProgress = ["running", "completed"].includes(input.finalValidation?.status);
  const translationComplete = Boolean(
    input.subtitleEditorComplete ||
    hasDubbingProgress ||
    hasFinalVideoProgress ||
    hasFinalValidationProgress,
  );
  const chineseReviewComplete = Boolean(
    input.chineseReviewComplete || translationComplete,
  );
  const stepDefinitions = [
    {
      id: "generateChinese",
      title: "生成中文字幕",
      panelId: "generateChinese",
      readyLabel: "产出最终中文字幕 SRT",
      runningLabel: "正在生成最终中文字幕",
      completedLabel: "最终中文字幕已就绪",
      blockedLabel: "等待原视频",
    },
    {
      id: "reviewChinese",
      title: "校正中文字幕",
      panelId: "reviewChinese",
      readyLabel: "打开字幕校正",
      runningLabel: "正在校正字幕",
      completedLabel: "中文字幕已校正",
      blockedLabel: "等待最终中文字幕",
    },
    {
      id: "translation",
      title: "翻译校对",
      panelId: "translation",
      readyLabel: "打开翻译校对",
      runningLabel: "正在校对译稿",
      completedLabel: "英文译稿已就绪",
      blockedLabel: "等待中文字幕",
    },
    {
      id: "englishDubbing",
      title: "英文配音",
      panelId: "englishDubbing",
      readyLabel: "打开英文配音",
      runningLabel: "正在英文配音与混音",
      completedLabel: "英文混音已就绪",
      blockedLabel: "等待英文译稿与音轨",
    },
    {
      id: "finalVideo",
      title: "导出成片",
      panelId: "finalVideo",
      readyLabel: "打开导出成片",
      runningLabel: "正在生成最终成片",
      completedLabel: "英文成片已完成",
      blockedLabel: "等待英文混音与字幕",
    },
    {
      id: "finalValidation",
      title: "最终验证",
      panelId: "finalValidation",
      readyLabel: "打开最终验证",
      runningLabel: "正在生成验证成片",
      completedLabel: "最终验证已完成",
      blockedLabel: "等待最终成片",
    },
  ];
  const steps = stepDefinitions.map((step, index) => {
    const state = step.id === "generateChinese"
      ? generationState(input)
      : step.id === "reviewChinese"
        ? chineseReviewComplete ? "completed" : canTranslate ? "ready" : "blocked"
      : step.id === "translation"
        ? translationComplete ? "completed" : canTranslate ? "ready" : "blocked"
        : step.id === "englishDubbing"
          ? hasFinalVideoProgress || hasFinalValidationProgress
            ? "completed"
            : statusOrBlocked(input.englishDubbing, input.englishDubbing?.canRun)
          : step.id === "finalVideo"
            ? hasFinalValidationProgress
              ? "completed"
              : statusOrBlocked(input.finalVideo, input.finalVideo?.canRun)
            : statusOrBlocked(
                input.finalValidation,
                input.finalVideo?.status === "completed",
              );
    return {
    id: step.id,
    title: step.title,
    panelId: step.panelId,
    index: index + 1,
    kind: step.id === "generateChinese" ? "auto" : "manual",
    state,
    label: labelForSimplifiedStep(step, state, input),
    actionLabel: step.id === "generateChinese"
      ? canTranslate ? "打开生成结果" : "开始生成中文字幕"
      : step.readyLabel,
  };
  });
  const completedCount = steps.filter((step) => completedStatuses.has(step.state)).length;
  const runningStep = steps.find((step) => step.state === "running");
  const actionableStep = steps.find((step) => readyStatuses.has(step.state));
  const blockedStep = steps.find((step) => !completedStatuses.has(step.state));
  const totalCount = steps.length;
  const percent = Math.round((completedCount / totalCount) * 100);

  if (completedCount === totalCount) {
    return {
      steps,
      completedCount,
      totalCount,
      percent,
      headline: "最终验证已完成",
      detail: "最终验证成片已经生成。",
      nextAction: null,
    };
  }

  if (runningStep) {
    return {
      steps,
      completedCount,
      totalCount,
      percent,
      headline: runningStep.label,
      detail: "当前阶段正在后台执行，完成后这里会自动刷新下一步。",
      nextAction: {
        id: runningStep.panelId || runningStep.id,
        kind: runningStep.kind,
        label: "处理中...",
        disabled: true,
      },
    };
  }

  if (actionableStep) {
    return {
      steps,
      completedCount,
      totalCount,
      percent,
      headline: actionableStep.label,
      detail:
        actionableStep.id === "generateChinese"
          ? "点击开始后，系统会自动完成音轨、字幕、说话人和最终中文字幕。"
          : "点击对应阶段后，只在下方显示这一阶段的操作页面。",
      nextAction: {
        id: actionableStep.panelId || actionableStep.id,
        kind: actionableStep.kind,
        label: actionableStep.actionLabel,
        disabled: false,
      },
    };
  }

  return {
    steps,
    completedCount,
    totalCount,
    percent,
    headline: blockedStep ? blockedStep.label : "等待输入",
    detail: "当前阶段缺少必要输入。点击对应阶段可以查看需要补齐的内容。",
    nextAction: null,
  };
}
