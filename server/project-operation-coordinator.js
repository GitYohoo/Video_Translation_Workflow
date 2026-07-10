function projectBusyError() {
  const error = new Error("项目仍有任务正在启动或运行，请先等待完成或取消任务。");
  error.code = "PROJECT_BUSY";
  return error;
}

export function createProjectOperationCoordinator({
  isProjectActive = () => false,
} = {}) {
  const pendingStarts = new Map();
  const mutatingProjects = new Set();

  function operationKey(videoId, operation) {
    return `${videoId}:${operation}`;
  }

  function projectHasPendingStart(videoId) {
    return [...pendingStarts.values()].some((entry) => entry.videoId === videoId);
  }

  function start(videoId, operation, action) {
    if (mutatingProjects.has(videoId)) {
      return Promise.reject(projectBusyError());
    }

    const key = operationKey(videoId, operation);
    const existing = pendingStarts.get(key);
    if (existing) {
      return existing.promise;
    }

    let startPromise;
    startPromise = Promise.resolve()
      .then(() => {
        if (mutatingProjects.has(videoId)) {
          throw projectBusyError();
        }
        return action();
      })
      .finally(() => {
        if (pendingStarts.get(key)?.promise === startPromise) {
          pendingStarts.delete(key);
        }
      });
    pendingStarts.set(key, { videoId, promise: startPromise });
    return startPromise;
  }

  async function mutate(videoId, action) {
    if (
      mutatingProjects.has(videoId) ||
      projectHasPendingStart(videoId) ||
      isProjectActive(videoId)
    ) {
      throw projectBusyError();
    }

    mutatingProjects.add(videoId);
    try {
      return await action();
    } finally {
      mutatingProjects.delete(videoId);
    }
  }

  return {
    mutate,
    start,
  };
}
