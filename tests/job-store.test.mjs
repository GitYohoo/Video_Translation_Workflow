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

test("persists stage updates for running jobs", async () => {
  const { store } = await temporaryJobStore();
  const running = await store.startJob({
    videoId: "video-3",
    workflow: "ocr-subtitles",
    stage: "ocr",
  });

  const updated = await store.updateJob(running.id, { stage: "punctuation" });

  assert.equal(updated.status, "running");
  assert.equal(updated.stage, "punctuation");
  assert.equal((await store.readJob(running.id)).stage, "punctuation");
});

test("persists failed job state with error text", async () => {
  const { store } = await temporaryJobStore();
  const running = await store.startJob({ videoId: "video-2", workflow: "ocr" });

  const failed = await store.failJob(running.id, "OCR 退出码：1");

  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "OCR 退出码：1");
  assert.ok(failed.finishedAt);
});

test("queues and starts a job with an incrementing attempt", async () => {
  const { store } = await temporaryJobStore();

  const queued = await store.queueJob({ videoId: "video-4", workflow: "final-video" });
  assert.equal(queued.status, "queued");
  assert.equal(queued.attempt, 1);
  assert.ok(queued.queuedAt);
  assert.equal(queued.startedAt, null);

  const running = await store.markJobRunning(queued.id, { stage: "rendering" });
  assert.equal(running.status, "running");
  assert.equal(running.stage, "rendering");
  assert.ok(running.startedAt);

  await store.failJob(running.id, "render failed");
  const retried = await store.queueJob({ videoId: "video-4", workflow: "final-video" });
  assert.equal(retried.status, "queued");
  assert.equal(retried.attempt, 2);
  assert.equal(retried.error, null);
  assert.equal(retried.finishedAt, null);
});

test("persists cancelled jobs without treating cancellation as an error", async () => {
  const { store } = await temporaryJobStore();
  const running = await store.startJob({ videoId: "video-5", workflow: "english-dubbing" });

  const cancelled = await store.cancelJob(running.id, "用户取消");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error, null);
  assert.equal(cancelled.cancellationReason, "用户取消");
  assert.ok(cancelled.finishedAt);
});

test("lists jobs for one project ordered by most recent update", async () => {
  const { store } = await temporaryJobStore();
  const first = await store.startJob({ videoId: "video-6", workflow: "ocr" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await store.startJob({ videoId: "video-6", workflow: "final-video" });
  await store.startJob({ videoId: "other-video", workflow: "ocr" });

  const jobs = await store.listJobs({ videoId: "video-6" });

  assert.deepEqual(jobs.map((job) => job.id), [second.id, first.id]);
});
