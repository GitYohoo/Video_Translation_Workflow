import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobController } from "../server/job-controller.js";
import { createJobStore } from "../server/job-store.js";
import { createTaskRegistry } from "../server/task-registry.js";

async function temporaryController() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vt-job-controller-"));
  const jobStore = createJobStore(directory);
  const taskRegistry = createTaskRegistry();
  return {
    jobStore,
    taskRegistry,
    controller: createJobController({ jobStore, taskRegistry }),
  };
}

test("gets and lists persisted jobs for a project", async () => {
  const { jobStore, controller } = await temporaryController();
  await jobStore.startJob({ videoId: "video-1", workflow: "ocr" });
  await jobStore.startJob({ videoId: "video-1", workflow: "final-video" });

  const job = await controller.get("video-1", "ocr");
  const jobs = await controller.list("video-1");

  assert.equal(job.workflow, "ocr");
  assert.equal(jobs.length, 2);
});

test("cancels a running task and persists cancellation", async () => {
  const { jobStore, taskRegistry, controller } = await temporaryController();
  const job = await jobStore.startJob({ videoId: "video-2", workflow: "final-video" });
  let cancelled = false;
  taskRegistry.register({
    id: job.id,
    cancel: async () => {
      cancelled = true;
    },
  });

  const result = await controller.cancel("video-2", "final-video");

  assert.equal(cancelled, true);
  assert.equal(result.status, "cancelled");
  assert.equal((await jobStore.readJob(job.id)).status, "cancelled");
});

test("cancels a queued task without an active process", async () => {
  const { jobStore, controller } = await temporaryController();
  const job = await jobStore.queueJob({ videoId: "video-3", workflow: "ocr" });

  const result = await controller.cancel("video-3", "ocr");

  assert.equal(result.id, job.id);
  assert.equal(result.status, "cancelled");
});

test("rejects cancellation for missing or finished jobs", async () => {
  const { jobStore, controller } = await temporaryController();
  const job = await jobStore.startJob({ videoId: "video-4", workflow: "ocr" });
  await jobStore.finishJob(job.id);

  await assert.rejects(() => controller.cancel("video-4", "ocr"), /不能取消/);
  await assert.rejects(() => controller.cancel("missing", "ocr"), /找不到任务/);
});

test("reports persisted running jobs as interrupted when no process is registered", async () => {
  const { jobStore, controller } = await temporaryController();
  await jobStore.startJob({ videoId: "video-5", workflow: "ocr" });

  const job = await controller.get("video-5", "ocr");

  assert.equal(job.status, "failed");
  assert.match(job.error, /上次运行中断/);
});
