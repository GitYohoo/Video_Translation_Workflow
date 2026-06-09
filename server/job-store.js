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
    await fs.writeFile(temporaryPath, JSON.stringify(job, null, 2), "utf8");
    await fs.rename(temporaryPath, targetPath);
    return job;
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

  async function startJob({ videoId, workflow, logPath = null, stage = null }) {
    const id = jobIdFor(videoId, workflow);
    return writeJob({
      id,
      videoId,
      workflow,
      status: "running",
      stage,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logPath,
      error: null,
    });
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
    });
  }

  async function failJob(jobId, errorMessage, updates = {}) {
    return finishJob(jobId, "failed", {
      ...updates,
      error: errorMessage,
    });
  }

  return {
    jobPath,
    readJob,
    writeJob,
    startJob,
    updateJob,
    finishJob,
    failJob,
  };
}
