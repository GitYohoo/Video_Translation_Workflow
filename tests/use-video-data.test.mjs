import assert from "node:assert/strict";
import test from "node:test";
import { workflowStatusKey } from "../src/use-video-data.js";

test("workflow status cache keys follow the source revision", () => {
  const first = workflowStatusKey("video-1", "subtitle-editor", "2026-07-16T10:00:00Z");
  const second = workflowStatusKey("video-1", "subtitle-editor", "2026-07-16T10:01:00Z");

  assert.notEqual(first, second);
  assert.equal(
    first,
    "/api/videos/video-1/workflow/subtitle-editor?revision=2026-07-16T10%3A00%3A00Z",
  );
  assert.equal(workflowStatusKey(null, "subtitle-editor", "revision"), null);
});
