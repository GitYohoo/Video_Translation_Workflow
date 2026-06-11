import assert from "node:assert/strict";
import test from "node:test";
import {
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
      detail: "可以播放视频并在下方直接更正字幕。",
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
