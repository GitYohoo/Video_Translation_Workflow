import { jobIdFor } from "./job-store.js";
import { recoverWorkflowTask } from "./workflow-job-state.js";

export function createJobController({ jobStore, taskRegistry }) {
  function normalizedJob(job) {
    if (!job) {
      return null;
    }
    const activeTask = taskRegistry.get(job.id);
    const recovered = activeTask?.status
      ? { ...job, ...activeTask }
      : recoverWorkflowTask(null, job);
    const { cancel: _cancel, ...publicJob } = recovered;
    return publicJob;
  }

  async function get(videoId, workflow) {
    return normalizedJob(await jobStore.readJob(jobIdFor(videoId, workflow)));
  }

  async function list(videoId) {
    return (await jobStore.listJobs({ videoId })).map(normalizedJob);
  }

  async function cancel(videoId, workflow, reason = "用户取消") {
    const job = await jobStore.readJob(jobIdFor(videoId, workflow));
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
