import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createJobRouter } from "../server/routes/job-routes.js";

async function withServer(router, callback) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function jobRouterFixture({ video = { id: "video-1" }, jobs = [] } = {}) {
  const calls = [];
  const router = createJobRouter({
    findVideoById: async (videoId) => (videoId === video?.id ? video : null),
    jobController: {
      list: async (videoId) => {
        calls.push(["list", videoId]);
        return jobs;
      },
      get: async (videoId, workflow) => {
        calls.push(["get", videoId, workflow]);
        return jobs.find((job) => job.workflow === workflow) || null;
      },
      cancel: async (videoId, workflow) => {
        calls.push(["cancel", videoId, workflow]);
        return { id: `${videoId}-${workflow}`, status: "cancelled" };
      },
    },
  });
  return { router, calls };
}

test("lists persisted jobs for an existing video", async () => {
  const jobs = [{ id: "video-1-ocr", workflow: "ocr", status: "failed" }];
  const { router, calls } = jobRouterFixture({ jobs });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/videos/video-1/jobs`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), jobs);
  });

  assert.deepEqual(calls, [["list", "video-1"]]);
});

test("returns 404 before calling the controller for an unknown video", async () => {
  const { router, calls } = jobRouterFixture({ video: null });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/videos/missing/jobs`);
    assert.equal(response.status, 404);
  });

  assert.deepEqual(calls, []);
});

test("returns 404 when a workflow job does not exist", async () => {
  const { router, calls } = jobRouterFixture();

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/videos/video-1/jobs/ocr`);
    assert.equal(response.status, 404);
  });

  assert.deepEqual(calls, [["get", "video-1", "ocr"]]);
});

test("cancels a workflow job and returns the persisted result", async () => {
  const { router, calls } = jobRouterFixture();

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/videos/video-1/jobs/ocr/cancel`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: "video-1-ocr",
      status: "cancelled",
    });
  });

  assert.deepEqual(calls, [["cancel", "video-1", "ocr"]]);
});

test("forwards controller errors to Express error handling", async () => {
  const router = createJobRouter({
    findVideoById: async () => ({ id: "video-1" }),
    jobController: {
      list: async () => [],
      get: async () => null,
      cancel: async () => {
        throw new Error("任务不能取消");
      },
    },
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/videos/video-1/jobs/ocr/cancel`, {
      method: "POST",
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "任务不能取消" });
  });
});
