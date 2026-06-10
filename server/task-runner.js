import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { activeTaskFromJob } from "./workflow-job-state.js";

export function createTaskRunner({
  jobStore,
  taskRegistry,
  spawnProcess = spawn,
  createOutput = (logPath) =>
    createWriteStream(logPath, { flags: "w", encoding: "utf8" }),
  terminateProcess,
  now = () => new Date().toISOString(),
}) {
  async function start({
    videoId,
    workflow,
    logPath,
    stage,
    activeTasks,
    activeKey = videoId,
    command,
    arguments: processArguments = [],
    spawnOptions = {},
    failureMessage = (code) => `处理进程退出码：${code}`,
    startFailureMessage = (error) => `任务启动失败：${error.message}`,
  }) {
    const output = createOutput(logPath);
    const job = await jobStore.startJob({ videoId, workflow, logPath, stage });
    const task = activeTaskFromJob(job);
    let child = null;
    let settled = false;

    function removeActiveTask() {
      if (activeTasks.get(activeKey) === task) {
        activeTasks.delete(activeKey);
      }
      taskRegistry.finish(task.id);
    }

    task.cancel = async () => {
      if (settled) {
        return;
      }
      settled = true;
      task.status = "cancelled";
      task.error = null;
      task.cancellationReason = "用户取消";
      task.finishedAt = now();
      removeActiveTask();
      if (child && terminateProcess) {
        await terminateProcess(child);
      }
      output.end("\n任务状态：cancelled\n用户已取消任务。\n");
    };
    activeTasks.set(activeKey, task);
    taskRegistry.register(task);

    async function finishTask(status, error = null) {
      if (settled) {
        return;
      }
      settled = true;
      task.status = status;
      task.error = error;
      task.finishedAt = now();
      if (status === "completed") {
        await jobStore.finishJob(task.id, "completed");
      } else {
        await jobStore.failJob(task.id, error);
      }
      removeActiveTask();
      output.end(`\n任务状态：${status}\n`);
    }

    try {
      child = spawnProcess(command, processArguments, spawnOptions);
    } catch (error) {
      await finishTask("failed", startFailureMessage(error));
      throw error;
    }
    child.stdout?.pipe(output, { end: false });
    child.stderr?.pipe(output, { end: false });
    child.on("error", (error) => {
      void finishTask("failed", startFailureMessage(error));
    });
    child.on("close", async (code) => {
      if (task.status !== "running") {
        return;
      }
      if (code === 0) {
        await finishTask("completed");
      } else {
        await finishTask("failed", failureMessage(code));
      }
    });

    return task;
  }

  return { start };
}
