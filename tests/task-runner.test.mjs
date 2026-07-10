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

function runnerFixture(overrides = {}) {
  const child = new FakeChildProcess();
  const output = new PassThrough();
  const outputChunks = [];
  output.on("data", (chunk) => outputChunks.push(chunk.toString()));
  const calls = [];
  const terminatedChildren = [];
  const jobStore = {
    startJob:
      overrides.startJob ||
      (async (input) => {
        calls.push(["start", input]);
        return {
          id: `${input.videoId}-${input.workflow}`,
          ...input,
          status: "running",
          startedAt: "2026-06-10T00:00:00.000Z",
          finishedAt: null,
          error: null,
        };
      }),
    finishJob:
      overrides.finishJob ||
      (async (...arguments_) => calls.push(["finish", ...arguments_])),
    failJob:
      overrides.failJob ||
      (async (...arguments_) => calls.push(["fail", ...arguments_])),
  };
  const taskRegistry = createTaskRegistry();
  const activeTasks = new Map();
  const runner = createTaskRunner({
    jobStore,
    taskRegistry,
    spawnProcess: overrides.spawnProcess || (() => child),
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

test("coalesces concurrent starts for the same workflow task", async () => {
  let releaseStart;
  let startCalls = 0;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  const fixture = runnerFixture({
    startJob: async (input) => {
      startCalls += 1;
      await startGate;
      return {
        id: `${input.videoId}-${input.workflow}`,
        ...input,
        status: "running",
        startedAt: "2026-06-10T00:00:00.000Z",
        finishedAt: null,
        error: null,
      };
    },
  });
  const options = {
    videoId: "video-concurrent",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs-concurrent.log",
    activeTasks: fixture.activeTasks,
    command: "python.exe",
  };

  const firstStart = fixture.runner.start(options);
  const secondStart = fixture.runner.start(options);
  assert.equal(startCalls, 1);

  releaseStart();
  const [firstTask, secondTask] = await Promise.all([firstStart, secondStart]);

  assert.equal(firstTask, secondTask);
  assert.equal(fixture.activeTasks.get("video-concurrent"), firstTask);
  assert.equal(fixture.taskRegistry.get(firstTask.id), firstTask);
});

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

test("cleans up and persists failure when spawning throws synchronously", async () => {
  const fixture = runnerFixture({
    spawnProcess: () => {
      throw new Error("invalid command");
    },
  });

  await assert.rejects(
    () =>
      fixture.runner.start({
        videoId: "video-5",
        workflow: "bs-roformer",
        logPath: "D:\\logs\\bs-spawn-error.log",
        activeTasks: fixture.activeTasks,
        command: "",
      }),
    /invalid command/,
  );

  assert.equal(fixture.activeTasks.has("video-5"), false);
  assert.equal(fixture.taskRegistry.get("video-5-bs-roformer"), null);
  assert.deepEqual(fixture.calls.at(-1), [
    "fail",
    "video-5-bs-roformer",
    "任务启动失败：invalid command",
  ]);
});

test("cleans up even when persisting the final state fails", async () => {
  const fixture = runnerFixture({
    finishJob: async () => {
      throw new Error("disk full");
    },
  });
  const task = await fixture.runner.start({
    videoId: "video-6",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs-persist-error.log",
    activeTasks: fixture.activeTasks,
    command: "python.exe",
  });

  fixture.child.emit("close", 0);
  await nextTurn();

  assert.equal(task.status, "completed");
  assert.equal(fixture.activeTasks.has("video-6"), false);
  assert.equal(fixture.taskRegistry.get(task.id), null);
  assert.match(fixture.outputChunks.join(""), /写入任务状态失败：disk full/);
  assert.match(fixture.outputChunks.join(""), /任务状态：completed/);
});
