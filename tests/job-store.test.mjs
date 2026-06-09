import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobStore, jobIdFor } from "../server/job-store.js";

async function temporaryJobStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vt-jobs-"));
  return {
    directory,
    store: createJobStore(directory),
  };
}

test("builds stable filesystem-safe job ids", () => {
  assert.equal(jobIdFor("video:01", "bs-roformer"), "video_01_bs-roformer");
  assert.equal(jobIdFor("视频/01", "final video"), "视频_01_final_video");
});

test("returns null for missing jobs", async () => {
  const { store } = await temporaryJobStore();

  assert.equal(await store.readJob("missing"), null);
});

test("persists running and completed job state", async () => {
  const { store } = await temporaryJobStore();
  const running = await store.startJob({
    videoId: "video-1",
    workflow: "bs-roformer",
    logPath: "D:\\logs\\bs.log",
  });

  assert.equal(running.id, "video-1_bs-roformer");
  assert.equal(running.status, "running");
  assert.equal(running.logPath, "D:\\logs\\bs.log");
  assert.ok(running.startedAt);

  const completed = await store.finishJob(running.id, "completed");

  assert.equal(completed.status, "completed");
  assert.ok(completed.finishedAt);
  assert.equal((await store.readJob(running.id)).status, "completed");
});

test("persists failed job state with error text", async () => {
  const { store } = await temporaryJobStore();
  const running = await store.startJob({ videoId: "video-2", workflow: "ocr" });

  const failed = await store.failJob(running.id, "OCR 退出码：1");

  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "OCR 退出码：1");
  assert.ok(failed.finishedAt);
});
