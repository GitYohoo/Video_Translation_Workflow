import express from "express";

export function createJobRouter({ findVideoById, jobController }) {
  const router = express.Router();

  router.param("id", async (request, response, next, id) => {
    const video = await findVideoById(id);
    if (!video) {
      response.sendStatus(404);
      return;
    }
    response.locals.video = video;
    next();
  });

  router.get("/api/videos/:id/jobs", async (_request, response) => {
    response.json(await jobController.list(response.locals.video.id));
  });

  router.get("/api/videos/:id/jobs/:workflow", async (request, response) => {
    const job = await jobController.get(response.locals.video.id, request.params.workflow);
    if (!job) {
      response.sendStatus(404);
      return;
    }
    response.json(job);
  });

  router.post(
    "/api/videos/:id/jobs/:workflow/cancel",
    async (request, response) => {
      response.json(
        await jobController.cancel(response.locals.video.id, request.params.workflow),
      );
    },
  );

  return router;
}
