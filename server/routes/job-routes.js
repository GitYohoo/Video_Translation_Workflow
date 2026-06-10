import express from "express";

export function createJobRouter({ findVideoById, jobController }) {
  const router = express.Router();

  async function requestVideo(request, response) {
    const video = await findVideoById(request.params.id);
    if (!video) {
      response.sendStatus(404);
      return null;
    }
    return video;
  }

  router.get("/api/videos/:id/jobs", async (request, response, next) => {
    try {
      const video = await requestVideo(request, response);
      if (!video) {
        return;
      }
      response.json(await jobController.list(video.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/videos/:id/jobs/:workflow", async (request, response, next) => {
    try {
      const video = await requestVideo(request, response);
      if (!video) {
        return;
      }
      const job = await jobController.get(video.id, request.params.workflow);
      if (!job) {
        response.sendStatus(404);
        return;
      }
      response.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/api/videos/:id/jobs/:workflow/cancel",
    async (request, response, next) => {
      try {
        const video = await requestVideo(request, response);
        if (!video) {
          return;
        }
        response.json(await jobController.cancel(video.id, request.params.workflow));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
