import assert from "node:assert/strict";
import test from "node:test";
import { createProjectOperationCoordinator } from "../server/project-operation-coordinator.js";

test("coalesces duplicate project operation starts", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = createProjectOperationCoordinator();
  const action = async () => {
    calls += 1;
    await gate;
    return { status: "running" };
  };

  const first = coordinator.start("video-1", "bs-roformer", action);
  const second = coordinator.start("video-1", "bs-roformer", action);
  await Promise.resolve();
  assert.equal(calls, 1);

  release();
  assert.equal(await first, await second);
});

test("blocks project mutation while a start is pending", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = createProjectOperationCoordinator();
  const start = coordinator.start("video-2", "ocr", () => gate);

  await assert.rejects(
    () => coordinator.mutate("video-2", async () => true),
    (error) => error.code === "PROJECT_BUSY",
  );

  release({ status: "running" });
  await start;
});

test("blocks project mutation while a task is active", async () => {
  const coordinator = createProjectOperationCoordinator({
    isProjectActive: (videoId) => videoId === "video-active",
  });

  await assert.rejects(
    () => coordinator.mutate("video-active", async () => true),
    (error) => error.code === "PROJECT_BUSY",
  );
});

test("blocks new starts until a project mutation finishes", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = createProjectOperationCoordinator();
  const mutation = coordinator.mutate("video-3", () => gate);

  await assert.rejects(
    () => coordinator.start("video-3", "final-video", async () => true),
    (error) => error.code === "PROJECT_BUSY",
  );

  release(true);
  await mutation;
});
