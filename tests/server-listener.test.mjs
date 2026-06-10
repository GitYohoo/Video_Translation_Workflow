import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { listenForRequests } from "../server/server-listener.js";

test("starts an Express app on an available local port", async (context) => {
  const app = express();
  app.get("/health", (_request, response) => response.json({ ready: true }));

  const listener = await listenForRequests(app, { port: 0 });
  context.after(() => new Promise((resolve) => listener.server.close(resolve)));

  assert.equal(listener.host, "127.0.0.1");
  assert.ok(listener.port > 0);
  assert.equal(listener.url, `http://127.0.0.1:${listener.port}`);

  const response = await fetch(`${listener.url}/health`);
  assert.deepEqual(await response.json(), { ready: true });
});
