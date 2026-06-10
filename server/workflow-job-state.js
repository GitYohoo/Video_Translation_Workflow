export function activeTaskFromJob(job) {
  return {
    id: job.id,
    status: "running",
    stage: job.stage ?? null,
    attempt: job.attempt ?? 1,
    startedAt: job.startedAt,
    finishedAt: null,
    logPath: job.logPath ?? null,
    error: null,
  };
}

export function recoverWorkflowTask(activeTask, persistedJob) {
  if (activeTask) {
    return activeTask;
  }
  if (!persistedJob) {
    return null;
  }
  if (!["queued", "running"].includes(persistedJob.status)) {
    return persistedJob;
  }
  return {
    ...persistedJob,
    status: "failed",
    error:
      persistedJob.error ||
      (persistedJob.status === "queued"
        ? "任务上次尚未开始即中断，请重新执行。"
        : "任务上次运行中断，请重新执行。"),
  };
}
