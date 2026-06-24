import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSimplifiedWorkflowOverview,
  nextAutomaticActions,
  summarizeAutomaticWorkflow,
} from "../src/simplified-workflow.js";

test("starts separation and OCR together for a new referenced project", () => {
  assert.deepEqual(
    nextAutomaticActions({
      started: true,
      storageMode: "reference",
      separation: { status: "ready" },
      ocr: { status: "ready" },
    }),
    ["separation", "ocr"],
  );
});

test("does not start a new project before the user clicks start", () => {
  assert.deepEqual(
    nextAutomaticActions({
      started: false,
      storageMode: "reference",
      separation: { status: "ready" },
      ocr: { status: "ready" },
    }),
    [],
  );
});

test("starts speaker recognition after the dialogue track is ready", () => {
  assert.deepEqual(
    nextAutomaticActions({
      started: true,
      storageMode: "reference",
      separation: { status: "completed" },
      ocr: { status: "running" },
      speakers: { status: "ready", canRun: true },
    }),
    ["speakers"],
  );
});

test("starts final subtitle merge after both subtitle inputs are ready", () => {
  assert.deepEqual(
    nextAutomaticActions({
      started: true,
      storageMode: "reference",
      separation: { status: "completed" },
      ocr: { status: "completed" },
      speakers: { status: "completed" },
      finalSubtitles: { status: "ready", canRun: true },
    }),
    ["finalSubtitles"],
  );
});

test("stops automatic actions after completion or failure", () => {
  assert.deepEqual(
    nextAutomaticActions({
      started: true,
      storageMode: "reference",
      separation: { status: "failed" },
      ocr: { status: "ready" },
    }),
    [],
  );
  assert.deepEqual(
    nextAutomaticActions({
      started: true,
      storageMode: "reference",
      finalSubtitles: { status: "completed" },
    }),
    [],
  );
});

test("summarizes the final result as complete", () => {
  assert.deepEqual(
    summarizeAutomaticWorkflow({ finalSubtitles: { status: "completed" } }),
    {
      state: "completed",
      title: "最终中文字幕已生成",
      detail: "可以进入校正中文字幕步骤，边播放边更正字幕。",
      percent: 100,
    },
  );
});

test("summarizes a new project as waiting for an explicit start", () => {
  assert.deepEqual(
    summarizeAutomaticWorkflow({ started: false }),
    {
      state: "ready",
      title: "准备生成最终中文字幕",
      detail: "点击开始后，将自动连续执行到最终中文字幕。",
      percent: 0,
    },
  );
});

test("summarizes the simplified workflow as six user-facing steps", () => {
  const overview = buildSimplifiedWorkflowOverview({
    started: false,
    storageMode: "reference",
    separation: { status: "ready" },
    ocr: { status: "ready" },
  });

  assert.deepEqual(
    overview.steps.map((step) => ({ id: step.id, title: step.title, panelId: step.panelId })),
    [
      { id: "generateChinese", title: "生成中文字幕", panelId: "generateChinese" },
      { id: "reviewChinese", title: "校正中文字幕", panelId: "reviewChinese" },
      { id: "translation", title: "翻译校对", panelId: "translation" },
      { id: "englishDubbing", title: "英文配音", panelId: "englishDubbing" },
      { id: "finalVideo", title: "导出成片", panelId: "finalVideo" },
      { id: "finalValidation", title: "最终验证", panelId: "finalValidation" },
    ],
  );
  assert.equal(overview.totalCount, 6);
  assert.equal(overview.nextAction.id, "generateChinese");
  assert.equal(overview.nextAction.label, "开始生成中文字幕");
  assert.equal(overview.steps[0].label, "产出最终中文字幕 SRT");
  assert.equal(overview.steps[1].label, "等待最终中文字幕");
});

test("opens subtitle review after the final Chinese SRT is ready", () => {
  const overview = buildSimplifiedWorkflowOverview({
    started: true,
    storageMode: "reference",
    separation: { status: "completed" },
    ocr: { status: "completed" },
    speakers: { status: "completed" },
    finalSubtitles: {
      status: "completed",
      outputs: { srt: { ready: true } },
    },
    subtitleEditorComplete: false,
  });

  assert.equal(overview.completedCount, 1);
  assert.equal(overview.steps[0].state, "completed");
  assert.equal(overview.steps[1].state, "ready");
  assert.equal(overview.nextAction.id, "reviewChinese");
  assert.equal(overview.nextAction.label, "打开字幕校正");
});

test("shows all six stages complete after final validation", () => {
  const overview = buildSimplifiedWorkflowOverview({
    started: true,
    storageMode: "reference",
    finalSubtitles: {
      status: "completed",
      outputs: { srt: { ready: true } },
    },
    subtitleEditorComplete: true,
    englishDubbing: { status: "completed" },
    finalVideo: { status: "completed" },
    finalValidation: { status: "completed" },
  });

  assert.equal(overview.completedCount, 6);
  assert.equal(overview.percent, 100);
  assert.equal(overview.headline, "最终验证已完成");
  assert.equal(overview.nextAction, null);
});
