import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createTaskRunner } from "../server/task-runner.js";
import { createTaskRegistry } from "../server/task-registry.js";

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 1234;
    this.exitCode = null;
    this.killed = false;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function runnerFixture() {
  const child = new FakeChildProcess();
  const output = new PassThrough();
  const outputChunks = [];
  output.on("data", (chunk) => outputChunks.push(chunk.toString()));
  const calls = [];
  const terminatedChildren = [];
  const jobStore = {
    startJob: async (input) => {
      calls.push(["start", input]);
      return {
        id: `${input.videoId}-${input.workflow}`,
        ...input,
        status: "running",
        startedAt: "2026-06-10T00:00:00.000Z",
        finishedAt: null,
        error: null,
      };
    },
    finishJob: async (...arguments_) => calls.push(["finish", ...arguments_]),
    failJob: async (...arguments_) => calls.push(["fail", ...arguments_]),
  };
  const taskRegistry = createTaskRegistry();
  const activeTasks = new Map();
  const runner = createTaskRunner({
    jobStore,
    taskRegistry,
    spawnProcess: () => child,
    createOutput: () => output,
    terminateProcess: async (process) => {
      terminatedChildren.push(process);
      return true;
    },
    now: () => "2026-06-10T00:01:00.000Z",
  });
  return {
    activeTasks,
    calls,
    child,
    outputChunks,
    runner,
    taskRegistry,
    terminatedChildren,
  };
}

test("persists and cleans up a completed single-process task", async () => {
  const fixture = runnerFixture();

  const task = await fixture.runner.start({
    videoId: "video-1",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs.log",
    activeTasks: fixture.activeTasks,
    activeKey: "video-1",
    command: "python.exe",
    arguments: ["workflow.py"],
    spawnOptions: { cwd: "D:\\workflow" },
  });

  assert.equal(task.status, "running");
  assert.equal(fixture.activeTasks.get("video-1"), task);
  assert.equal(fixture.taskRegistry.get(task.id), task);

  fixture.child.emit("close", 0);
  await nextTurn();

  assert.equal(task.status, "completed");
  assert.equal(task.finishedAt, "2026-06-10T00:01:00.000Z");
  assert.equal(fixture.activeTasks.has("video-1"), false);
  assert.equal(fixture.taskRegistry.get(task.id), null);
  assert.deepEqual(fixture.calls.at(-1), ["finish", task.id, "completed"]);
  assert.match(fixture.outputChunks.join(""), /任务状态：completed/);
});

test("persists a non-zero process exit as failed", async () => {
  const fixture = runnerFixture();
  const task = await fixture.runner.start({
    videoId: "video-2",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs-failed.log",
    activeTasks: fixture.activeTasks,
    activeKey: "video-2",
    command: "python.exe",
    failureMessage: (code) => `处理进程退出码：${code}`,
  });

  fixture.child.emit("close", 7);
  await nextTurn();

  assert.equal(task.status, "failed");
  assert.equal(task.error, "处理进程退出码：7");
  assert.equal(fixture.activeTasks.has("video-2"), false);
  assert.equal(fixture.taskRegistry.get(task.id), null);
  assert.deepEqual(fixture.calls.at(-1), ["fail", task.id, task.error]);
  assert.match(fixture.outputChunks.join(""), /任务状态：failed/);
});

test("persists a process startup error as failed", async () => {
  const fixture = runnerFixture();
  const task = await fixture.runner.start({
    videoId: "video-3",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs-start-error.log",
    activeTasks: fixture.activeTasks,
    command: "missing-python.exe",
    startFailureMessage: (error) => `任务启动失败：${error.message}`,
  });

  fixture.child.emit("error", new Error("ENOENT"));
  await nextTurn();

  assert.equal(task.status, "failed");
  assert.equal(task.error, "任务启动失败：ENOENT");
  assert.equal(fixture.activeTasks.has("video-3"), false);
  assert.equal(fixture.taskRegistry.get(task.id), null);
  assert.deepEqual(fixture.calls.at(-1), ["fail", task.id, task.error]);
});

test("cancels the active process without allowing close to overwrite the state", async () => {
  const fixture = runnerFixture();
  const task = await fixture.runner.start({
    videoId: "video-4",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs-cancelled.log",
    activeTasks: fixture.activeTasks,
    command: "python.exe",
  });

  await fixture.taskRegistry.cancel(task.id);

  assert.equal(task.status, "cancelled");
  assert.equal(task.error, null);
  assert.equal(task.cancellationReason, "用户取消");
  assert.equal(task.finishedAt, "2026-06-10T00:01:00.000Z");
  assert.deepEqual(fixture.terminatedChildren, [fixture.child]);
  assert.equal(fixture.activeTasks.has("video-4"), false);
  assert.match(fixture.outputChunks.join(""), /用户已取消任务/);

  fixture.child.emit("close", 1);
  await nextTurn();

  assert.equal(task.status, "cancelled");
  assert.equal(fixture.calls.some(([name]) => name === "fail"), false);
});
