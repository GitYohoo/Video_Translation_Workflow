export function createTaskRegistry() {
  const activeTasks = new Map();

  function register(task) {
    if (!task?.id || typeof task.cancel !== "function") {
      throw new Error("任务必须包含 id 和 cancel 处理器。");
    }
    if (activeTasks.has(task.id)) {
      throw new Error(`任务已在运行：${task.id}`);
    }
    activeTasks.set(task.id, task);
    return task;
  }

  function get(taskId) {
    return activeTasks.get(taskId) || null;
  }

  function finish(taskId) {
    return activeTasks.delete(taskId);
  }

  async function cancel(taskId) {
    const task = get(taskId);
    if (!task) {
      throw new Error(`没有正在运行的任务：${taskId}`);
    }
    activeTasks.delete(taskId);
    await task.cancel();
    return true;
  }

  return {
    register,
    get,
    finish,
    cancel,
  };
}
