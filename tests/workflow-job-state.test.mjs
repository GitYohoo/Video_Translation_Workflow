import assert from "node:assert/strict";
import test from "node:test";
import { activeTaskFromJob, recoverWorkflowTask } from "../server/workflow-job-state.js";

test("prefers active in-memory task over persisted job", () => {
  const task = recoverWorkflowTask(
    { status: "running", startedAt: "now", error: null },
    { status: "failed", error: "old failure" },
  );

  assert.equal(task.status, "running");
  assert.equal(task.error, null);
});

test("uses persisted completed or failed jobs when no active task exists", () => {
  assert.deepEqual(
    recoverWorkflowTask(null, { status: "completed", finishedAt: "done", error: null }),
    { status: "completed", finishedAt: "done", error: null },
  );
  assert.deepEqual(
    recoverWorkflowTask(null, { status: "failed", error: "bad" }),
    { status: "failed", error: "bad" },
  );
});

test("marks persisted running jobs as interrupted after restart", () => {
  const task = recoverWorkflowTask(null, {
    status: "running",
    startedAt: "before-restart",
    error: null,
  });

  assert.equal(task.status, "failed");
  assert.equal(task.startedAt, "before-restart");
  assert.match(task.error, /上次运行中断/);
});

test("returns null when no task exists", () => {
  assert.equal(recoverWorkflowTask(null, null), null);
});

test("builds active task state from a persisted running job", () => {
  const task = activeTaskFromJob({
    id: "video-1_whisperx-speakers",
    status: "running",
    stage: "alignment",
    startedAt: "start",
    finishedAt: null,
    logPath: "D:\\logs\\whisperx.log",
    error: null,
  });

  assert.deepEqual(task, {
    id: "video-1_whisperx-speakers",
    status: "running",
    stage: "alignment",
    startedAt: "start",
    finishedAt: null,
    logPath: "D:\\logs\\whisperx.log",
    error: null,
  });
});
