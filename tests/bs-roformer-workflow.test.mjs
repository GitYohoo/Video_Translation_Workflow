import assert from "node:assert/strict";
import test from "node:test";
import { createBsRoformerWorkflow } from "../server/workflows/bs-roformer.js";

function workflowFixture(overrides = {}) {
  const activeTasks = new Map();
  const calls = [];
  const taskRunner = {
    start: async (options) => {
      calls.push(["start", options]);
      activeTasks.set(options.activeKey, { status: "running" });
      return { status: "running" };
    },
  };
  const workflow = createBsRoformerWorkflow({
    activeTasks,
    outputPaths:
      overrides.outputPaths ||
      (() => ({ outputDirectory: "D:\\project\\BS-RoFormer_二轨分离" })),
    sourceFileStatus:
      overrides.sourceFileStatus || (async () => ({ ready: true, error: null })),
    getStatus: async () => ({ status: "running" }),
    isFile: overrides.isFile || (async () => true),
    ensureDirectory: async (directory) => calls.push(["mkdir", directory]),
    taskRunner,
    configuration: {
      pythonPath: "D:\\runtime\\python.exe",
      coreScript: "D:\\workflow\\scripts\\bs_roformer_refinement.py",
      runtimeDirectory: "D:\\workflow\\.runtime",
      temporaryDirectory: "D:\\workflow\\.runtime\\tmp",
      modelDirectory: "D:\\workflow\\.runtime\\models",
      logDirectory: "D:\\workflow\\data\\logs",
      workingDirectory: "D:\\workflow",
      environment: { PYTHONUTF8: "1" },
    },
  });
  return { activeTasks, calls, workflow };
}

test("starts BS-RoFormer through the shared task runner", async () => {
  const { activeTasks, calls, workflow } = workflowFixture();
  const record = {
    id: "video-1",
    sourcePath: "D:\\videos\\source.mp4",
  };

  const status = await workflow.start(record);

  assert.deepEqual(status, { status: "running" });
  assert.deepEqual(calls[0], ["mkdir", "D:\\workflow\\.runtime\\tmp"]);
  const runnerOptions = calls[1][1];
  assert.equal(runnerOptions.videoId, "video-1");
  assert.equal(runnerOptions.workflow, "bs-roformer");
  assert.equal(runnerOptions.command, "D:\\runtime\\python.exe");
  assert.deepEqual(runnerOptions.arguments, [
    "D:\\workflow\\scripts\\bs_roformer_refinement.py",
    "--video",
    "D:\\videos\\source.mp4",
    "--runtime-dir",
    "D:\\workflow\\.runtime",
    "--output-root",
    "D:\\project\\BS-RoFormer_二轨分离",
  ]);
  assert.deepEqual(runnerOptions.spawnOptions, {
    cwd: "D:\\workflow",
    windowsHide: true,
    env: { PYTHONUTF8: "1" },
  });
  assert.equal(runnerOptions.activeKey, "video-1");
  assert.equal(runnerOptions.activeTasks, activeTasks);
});

test("rejects projects without a source video path", async () => {
  const { calls, workflow } = workflowFixture({ outputPaths: () => null });

  await assert.rejects(
    () => workflow.start({ id: "video-missing", sourcePath: null }),
    /没有原视频路径/,
  );
  assert.deepEqual(calls, []);
});

test("reports a missing source file before starting the task", async () => {
  const { calls, workflow } = workflowFixture({
    sourceFileStatus: async () => ({
      ready: false,
      error: "原视频文件已移动，请重新选择。",
    }),
  });

  await assert.rejects(
    () => workflow.start({ id: "video-moved", sourcePath: "D:\\missing.mp4" }),
    /原视频文件已移动/,
  );
  assert.deepEqual(calls, []);
});

test("returns the current status when BS-RoFormer is already running", async () => {
  const { activeTasks, calls, workflow } = workflowFixture();
  activeTasks.set("video-running", { status: "running" });

  const status = await workflow.start({
    id: "video-running",
    sourcePath: "D:\\videos\\source.mp4",
  });

  assert.deepEqual(status, { status: "running" });
  assert.deepEqual(calls, []);
});

test("reports a missing BS-RoFormer script before creating runtime files", async () => {
  const { calls, workflow } = workflowFixture({
    isFile: async (filePath) => !filePath.endsWith("bs_roformer_refinement.py"),
  });

  await assert.rejects(
    () =>
      workflow.start({
        id: "video-no-script",
        sourcePath: "D:\\videos\\source.mp4",
      }),
    /找不到 BS-RoFormer 核心脚本/,
  );
  assert.deepEqual(calls, []);
});
