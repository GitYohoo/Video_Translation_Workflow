import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkflowOverview, workflowStageGroups } from "../src/workflow-summary.js";

test("points a new referenced project to the first production step", () => {
  const overview = buildWorkflowOverview({
    storageMode: "reference",
    separation: { status: "ready" },
    ocr: { status: "ready" },
  });

  assert.equal(overview.nextAction.id, "separation");
  assert.equal(overview.nextAction.label, "开始二轨分离");
  assert.equal(overview.completedCount, 0);
  assert.equal(overview.steps[0].state, "ready");
});

test("moves to speaker detection after audio and OCR outputs are ready", () => {
  const overview = buildWorkflowOverview({
    storageMode: "reference",
    separation: { status: "completed" },
    ocr: { status: "completed" },
    speakers: { status: "ready", canRun: true },
  });

  assert.equal(overview.nextAction.id, "speakers");
  assert.equal(overview.completedCount, 2);
  assert.equal(overview.steps[2].state, "ready");
});

test("uses a manual review action when Chinese subtitles are ready but translation is incomplete", () => {
  const overview = buildWorkflowOverview({
    storageMode: "reference",
    separation: { status: "completed" },
    ocr: { status: "completed" },
    speakers: { status: "completed" },
    finalSubtitles: { status: "completed" },
    canTranslate: true,
    subtitleEditorComplete: false,
  });

  assert.equal(overview.nextAction.id, "translation");
  assert.equal(overview.nextAction.kind, "manual");
  assert.equal(overview.nextAction.label, "去翻译与校对");
});

test("summarizes the currently running step before offering another action", () => {
  const overview = buildWorkflowOverview({
    storageMode: "reference",
    separation: { status: "completed" },
    ocr: { status: "completed" },
    speakers: { status: "completed" },
    finalSubtitles: { status: "completed" },
    canTranslate: true,
    subtitleEditorComplete: true,
    englishDubbing: { status: "running", stage: "dubbing" },
  });

  assert.equal(overview.nextAction.id, "englishDubbing");
  assert.equal(overview.nextAction.disabled, true);
  assert.match(overview.headline, /正在/);
});

test("marks the project complete when the final video exists", () => {
  const overview = buildWorkflowOverview({
    storageMode: "reference",
    separation: { status: "completed" },
    ocr: { status: "completed" },
    speakers: { status: "completed" },
    finalSubtitles: { status: "completed" },
    canTranslate: true,
    subtitleEditorComplete: true,
    englishDubbing: { status: "completed" },
    finalVideo: { status: "completed" },
  });

  assert.equal(overview.nextAction, null);
  assert.equal(overview.completedCount, overview.totalCount);
  assert.equal(overview.percent, 100);
});

test("keeps completed workflow state visible for legacy storage records", () => {
  const overview = buildWorkflowOverview({
    storageMode: "copy",
    separation: { status: "completed" },
    ocr: { status: "completed" },
    speakers: { status: "completed" },
    finalSubtitles: { status: "completed" },
    canTranslate: true,
    subtitleEditorComplete: true,
    englishDubbing: { status: "completed" },
    finalVideo: { status: "completed" },
  });

  assert.equal(overview.completedCount, overview.totalCount);
  assert.equal(overview.nextAction, null);
});

test("groups the primary workflow into user-facing stages", () => {
  assert.deepEqual(
    workflowStageGroups.map((group) => ({
      id: group.id,
      stepIds: group.stepIds,
    })),
    [
      { id: "assets", stepIds: ["separation", "ocr", "speakers"] },
      { id: "subtitles", stepIds: ["finalSubtitles", "translation"] },
      { id: "dubbing", stepIds: ["englishDubbing"] },
      { id: "delivery", stepIds: ["finalVideo"] },
    ],
  );
});
