import { jobIdFor } from "./job-store.js";

export function createJobController({ jobStore, taskRegistry }) {
  async function get(videoId, workflow) {
    return jobStore.readJob(jobIdFor(videoId, workflow));
  }

  async function list(videoId) {
    return jobStore.listJobs({ videoId });
  }

  async function cancel(videoId, workflow, reason = "用户取消") {
    const job = await get(videoId, workflow);
    if (!job) {
      throw new Error(`找不到任务：${workflow}`);
    }
    if (!["queued", "running"].includes(job.status)) {
      throw new Error(`任务当前状态为 ${job.status}，不能取消。`);
    }
    if (job.status === "running") {
      if (!taskRegistry.get(job.id)) {
        throw new Error("任务进程已经中断，不能取消，请重新执行。");
      }
      await taskRegistry.cancel(job.id);
    }
    return jobStore.cancelJob(job.id, reason);
  }

  return {
    get,
    list,
    cancel,
  };
}
