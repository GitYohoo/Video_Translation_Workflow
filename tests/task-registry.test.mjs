import assert from "node:assert/strict";
import test from "node:test";
import { createTaskRegistry } from "../server/task-registry.js";

test("registers and returns an active task", () => {
  const registry = createTaskRegistry();
  const task = { id: "video-1_ocr", status: "running", cancel: async () => {} };

  registry.register(task);

  assert.equal(registry.get(task.id), task);
});

test("cancels an active task once and removes it from the registry", async () => {
  const registry = createTaskRegistry();
  let cancelCalls = 0;
  registry.register({
    id: "video-1_final-video",
    status: "running",
    cancel: async () => {
      cancelCalls += 1;
    },
  });

  const cancelled = await registry.cancel("video-1_final-video");

  assert.equal(cancelled, true);
  assert.equal(cancelCalls, 1);
  assert.equal(registry.get("video-1_final-video"), null);
});

test("finished or missing tasks cannot be cancelled", async () => {
  const registry = createTaskRegistry();
  registry.register({ id: "video-1_done", status: "running", cancel: async () => {} });
  registry.finish("video-1_done");

  await assert.rejects(() => registry.cancel("video-1_done"), /没有正在运行的任务/);
  await assert.rejects(() => registry.cancel("missing"), /没有正在运行的任务/);
});

test("rejects duplicate active task registration", () => {
  const registry = createTaskRegistry();
  registry.register({ id: "video-1_ocr", status: "running", cancel: async () => {} });

  assert.throws(
    () => registry.register({ id: "video-1_ocr", status: "running", cancel: async () => {} }),
    /任务已在运行/,
  );
});
