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
