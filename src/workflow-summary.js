const primarySteps = [
  {
    id: "separation",
    title: "准备音轨",
    readyLabel: "开始二轨分离",
    runningLabel: "正在分离音轨",
    completedLabel: "音轨已就绪",
    blockedLabel: "等待原视频",
  },
  {
    id: "ocr",
    title: "提取字幕",
    readyLabel: "开始 OCR 字幕",
    runningLabel: "正在提取字幕",
    completedLabel: "字幕已就绪",
    blockedLabel: "等待原视频",
  },
  {
    id: "speakers",
    title: "识别说话人",
    readyLabel: "开始说话人识别",
    runningLabel: "正在识别说话人",
    completedLabel: "说话人参考已就绪",
    blockedLabel: "等待 DX 对白轨",
  },
  {
    id: "finalSubtitles",
    title: "中文字幕",
    readyLabel: "生成最终中文字幕",
    runningLabel: "正在合成中文字幕",
    completedLabel: "中文字幕已就绪",
    blockedLabel: "等待 OCR 与说话人字幕",
  },
  {
    id: "translation",
    title: "翻译校对",
    readyLabel: "去翻译与校对",
    runningLabel: "正在校对",
    completedLabel: "英文译稿已就绪",
    blockedLabel: "等待中文字幕",
    kind: "manual",
  },
  {
    id: "englishDubbing",
    title: "英文配音",
    readyLabel: "开始英文配音",
    runningLabel: "正在英文配音与混音",
    completedLabel: "英文混音已就绪",
    blockedLabel: "等待英文译稿与音轨",
  },
  {
    id: "finalVideo",
    title: "导出成片",
    readyLabel: "生成最终成片",
    runningLabel: "正在生成最终成片",
    completedLabel: "英文成片已完成",
    blockedLabel: "等待英文混音与字幕",
  },
  {
    id: "finalValidation",
    title: "最终验证",
    readyLabel: "开始最终验证",
    runningLabel: "正在生成验证成片",
    completedLabel: "最终验证已完成",
    blockedLabel: "等待最终成片",
  },
];

export const workflowStageGroups = [
  {
    id: "assets",
    eyebrow: "阶段 01",
    title: "素材准备",
    description: "准备对白轨、画面字幕和候选说话人参考，后续翻译与配音都会复用这些素材。",
    stepIds: ["separation", "ocr", "speakers"],
  },
  {
    id: "subtitles",
    eyebrow: "阶段 02",
    title: "字幕翻译",
    description: "合并中文字幕，交给 Gemini 翻译，再人工校对角色和英文字幕。",
    stepIds: ["finalSubtitles", "translation"],
  },
  {
    id: "dubbing",
    eyebrow: "阶段 03",
    title: "英文配音",
    description: "生成英文配音和成片混音。",
    stepIds: ["englishDubbing"],
  },
  {
    id: "delivery",
    eyebrow: "阶段 04",
    title: "成片导出",
    description: "确认字幕样式后替换英文音轨，烧录字幕并输出最终英文成片。",
    stepIds: ["finalVideo"],
  },
  {
    id: "validation",
    eyebrow: "阶段 05",
    title: "最终验证",
    description: "播放最终成片，并按时间段替换原声或清除 MX+FX 背景底轨。",
    stepIds: ["finalValidation"],
  },
];

const completedStatus = new Set(["completed"]);
const readyStatus = new Set(["ready", "failed"]);

function statusForStep(input, step) {
  if (step.id === "translation") {
    if (input.subtitleEditorComplete) {
      return "completed";
    }
    return input.canTranslate ? "ready" : "blocked";
  }
  if (step.id === "finalValidation") {
    return input.finalValidation?.status ||
      (input.finalVideo?.status === "completed" ? "ready" : "blocked");
  }
  const status = input[step.id]?.status;
  if (status) {
    return status;
  }
  if (input.storageMode && input.storageMode !== "reference") {
    return "blocked";
  }
  return step.id === "separation" || step.id === "ocr" ? "ready" : "blocked";
}

function labelForStep(step, state) {
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

export function buildWorkflowOverview(input = {}) {
  const steps = primarySteps.map((step, index) => {
    const state = statusForStep(input, step);
    return {
      id: step.id,
      title: step.title,
      index: index + 1,
      kind: step.kind || "auto",
      state,
      label: labelForStep(step, state),
    };
  });
  const completedCount = steps.filter((step) => completedStatus.has(step.state)).length;
  const runningStep = steps.find((step) => step.state === "running");
  const actionableStep = steps.find((step) => readyStatus.has(step.state));
  const blockedStep = steps.find((step) => !completedStatus.has(step.state));
  const totalCount = steps.length;
  const percent = Math.round((completedCount / totalCount) * 100);

  if (completedCount === totalCount) {
    return {
      steps,
      completedCount,
      totalCount,
      percent,
      headline: "英文成片已生成",
      detail: "主要流程已经完成，可以在导出成片步骤中打开最终 MP4。",
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
      detail: "任务正在后台执行，完成后页面会自动刷新下一步。",
      nextAction: {
        id: runningStep.id,
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
        actionableStep.kind === "manual"
          ? "这一步需要人工检查内容质量，确认后后续配音会更稳定。"
          : "点击主操作后可以继续推进当前项目。",
      nextAction: {
        id: actionableStep.id,
        kind: actionableStep.kind,
        label: actionableStep.label,
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
    detail: "当前步骤缺少必要输入。先查看下方对应步骤的输入文件和错误信息。",
    nextAction: null,
  };
}
