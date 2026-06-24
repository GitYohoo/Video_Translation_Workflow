import assert from "node:assert/strict";
import test from "node:test";

import {
  createFinalValidationWorkflow,
  normalizeValidationRanges,
} from "../server/workflows/final-validation.js";

test("normalizes, sorts, and merges overlapping validation ranges", () => {
  assert.deepEqual(
    normalizeValidationRanges([
      { start: 8.5, end: 10 },
      { start: 1, end: 3 },
      { start: 2.5, end: 4 },
      { start: 12, end: 12.001 },
    ]),
    [
      { start: 1, end: 4 },
      { start: 8.5, end: 10 },
      { start: 12, end: 12.001 },
    ],
  );
});

test("rejects invalid validation ranges", () => {
  assert.throws(
    () => normalizeValidationRanges([{ start: 3, end: 2 }]),
    /结束时间必须晚于开始时间/,
  );
  assert.throws(
    () => normalizeValidationRanges([{ start: -1, end: 2 }]),
    /时间不能小于 0/,
  );
});

test("starts final validation through the shared task runner", async () => {
  const activeTasks = new Map();
  const calls = [];
  const paths = {
    inputs: {
      finalVideo: "D:\\project\\base.mp4",
      sourceVideo: "D:\\project\\source.mp4",
      dialogue: "D:\\project\\dialogue.wav",
      background: "D:\\project\\background.wav",
    },
    outputDirectory: "D:\\project",
    configPath: "D:\\project\\video_最终验证配置.json",
  };
  const workflow = createFinalValidationWorkflow({
    activeTasks,
    outputPaths: () => paths,
    getFinalVideoStatus: async () => ({ status: "completed" }),
    getStatus: async () => ({ status: "running" }),
    isFile: async () => true,
    ensureDirectory: async (directory) => calls.push(["mkdir", directory]),
    saveConfiguration: async (filePath, configuration) =>
      calls.push(["save", filePath, configuration]),
    buildArguments: (receivedPaths) => ["final_validation.py", "--config", receivedPaths.configPath],
    taskRunner: {
      start: async (options) => calls.push(["start", options]),
    },
    configuration: {
      pythonPath: "D:\\runtime\\python.exe",
      coreScript: "D:\\workflow\\scripts\\final_validation.py",
      ffmpegPath: "D:\\tools\\ffmpeg.exe",
      logDirectory: "D:\\workflow\\data\\logs",
      workingDirectory: "D:\\workflow",
      environment: { PYTHONUTF8: "1" },
    },
  });
  const requested = {
    sourceAudioRanges: [{ start: 3, end: 5 }],
    mutedBackgroundRanges: [{ start: 10, end: 12 }],
  };

  assert.deepEqual(await workflow.start({ id: "video-1" }, requested), {
    status: "running",
  });
  assert.deepEqual(calls[0], ["mkdir", paths.outputDirectory]);
  assert.deepEqual(calls[1], ["save", paths.configPath, requested]);
  const options = calls[2][1];
  assert.equal(options.workflow, "final-validation");
  assert.equal(options.command, "D:\\runtime\\python.exe");
  assert.deepEqual(options.arguments, [
    "final_validation.py",
    "--config",
    paths.configPath,
  ]);
});

test("requires a completed fifth step before final validation", async () => {
  const workflow = createFinalValidationWorkflow({
    activeTasks: new Map(),
    outputPaths: () => ({ inputs: {}, outputDirectory: "D:\\project" }),
    getFinalVideoStatus: async () => ({ status: "ready" }),
    getStatus: async () => ({}),
    isFile: async () => true,
    ensureDirectory: async () => {},
    saveConfiguration: async () => {},
    buildArguments: () => [],
    taskRunner: { start: async () => {} },
    configuration: {},
  });

  await assert.rejects(
    () => workflow.start({ id: "video-2" }, {}),
    /请先完成导出成片/,
  );
});
