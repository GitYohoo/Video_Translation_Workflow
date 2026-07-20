import assert from "node:assert/strict";
import test from "node:test";
import { requestJson } from "../src/api.js";

test("requestJson returns JSON for a successful response", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "completed" }),
  });

  assert.deepEqual(await requestJson("/api/example"), { status: "completed" });
});

test("requestJson returns null for an empty successful response", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: true,
    status: 204,
    json: async () => assert.fail("204 responses must not be parsed as JSON"),
  });

  assert.equal(await requestJson("/api/example", { method: "DELETE" }), null);
});

test("requestJson preserves API error messages and status codes", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: "项目不存在。" }),
  });

  await assert.rejects(
    requestJson("/api/missing"),
    (error) => error.message === "项目不存在。" && error.status === 404,
  );
});
