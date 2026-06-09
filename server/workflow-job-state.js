export function activeTaskFromJob(job) {
  return {
    id: job.id,
    status: "running",
    stage: job.stage ?? null,
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
  if (persistedJob.status !== "running") {
    return persistedJob;
  }
  return {
    ...persistedJob,
    status: "failed",
    error: persistedJob.error || "任务上次运行中断，请重新执行。",
  };
}
