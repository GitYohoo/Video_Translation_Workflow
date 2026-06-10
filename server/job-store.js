import fs from "node:fs/promises";
import path from "node:path";

const unsafeJobIdCharacters = /[<>:"/\\|?*\s\u0000-\u001F]/g;

export function jobIdFor(videoId, workflow) {
  return `${videoId}_${workflow}`.replace(unsafeJobIdCharacters, "_");
}

export function createJobStore(jobDirectory) {
  function jobPath(jobId) {
    return path.join(jobDirectory, `${jobId}.json`);
  }

  async function writeJob(job) {
    await fs.mkdir(jobDirectory, { recursive: true });
    const targetPath = jobPath(job.id);
    const temporaryPath = `${targetPath}.tmp`;
    const persistedJob = {
      ...job,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(temporaryPath, JSON.stringify(persistedJob, null, 2), "utf8");
    await fs.rename(temporaryPath, targetPath);
    return persistedJob;
  }

  async function readJob(jobId) {
    try {
      return JSON.parse(await fs.readFile(jobPath(jobId), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function queueJob({ videoId, workflow, logPath = null, stage = null }) {
    const id = jobIdFor(videoId, workflow);
    const existing = await readJob(id);
    const queuedAt = new Date().toISOString();
    return writeJob({
      id,
      videoId,
      workflow,
      status: "queued",
      attempt: (existing?.attempt || 0) + 1,
      stage,
      createdAt: existing?.createdAt || queuedAt,
      queuedAt,
      startedAt: null,
      finishedAt: null,
      logPath,
      error: null,
      cancellationReason: null,
    });
  }

  async function markJobRunning(jobId, updates = {}) {
    const existing = await readJob(jobId);
    if (!existing) {
      throw new Error(`找不到任务：${jobId}`);
    }
    return writeJob({
      ...existing,
      ...updates,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      cancellationReason: null,
    });
  }

  async function startJob(options) {
    const queued = await queueJob(options);
    return markJobRunning(queued.id);
  }

  async function updateJob(jobId, updates) {
    const existing = (await readJob(jobId)) || { id: jobId };
    return writeJob({
      ...existing,
      ...updates,
    });
  }

  async function finishJob(jobId, status = "completed", updates = {}) {
    const existing = (await readJob(jobId)) || { id: jobId };
    return writeJob({
      ...existing,
      ...updates,
      status,
      finishedAt: new Date().toISOString(),
      error: status === "completed" ? null : updates.error || existing.error || null,
      cancellationReason: status === "completed" ? null : existing.cancellationReason || null,
    });
  }

  async function failJob(jobId, errorMessage, updates = {}) {
    return finishJob(jobId, "failed", {
      ...updates,
      error: errorMessage,
      cancellationReason: null,
    });
  }

  async function cancelJob(jobId, cancellationReason = "用户取消") {
    const existing = await readJob(jobId);
    if (!existing) {
      throw new Error(`找不到任务：${jobId}`);
    }
    return writeJob({
      ...existing,
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      error: null,
      cancellationReason,
    });
  }

  async function listJobs({ videoId } = {}) {
    let entries;
    try {
      entries = await fs.readdir(jobDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readJob(entry.name.slice(0, -5))),
    );
    return jobs
      .filter((job) => job && (!videoId || job.videoId === videoId))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  return {
    jobPath,
    readJob,
    writeJob,
    queueJob,
    markJobRunning,
    startJob,
    updateJob,
    finishJob,
    failJob,
    cancelJob,
    listJobs,
  };
}
