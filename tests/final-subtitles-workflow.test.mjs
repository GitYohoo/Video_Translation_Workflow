import assert from "node:assert/strict";
import test from "node:test";
import { createFinalSubtitlesWorkflow } from "../server/workflows/final-subtitles.js";

function fixture(overrides = {}) {
  const activeTasks = new Map();
  const calls = [];
  const paths = {
    inputs: {
      speakerSrt: "D:\\project\\speakers.srt",
      ocrSrt: "D:\\project\\ocr.srt",
    },
    outputDirectory: "D:\\project\\最终中文字幕",
    videoStem: "source",
  };
  const workflow = createFinalSubtitlesWorkflow({
    activeTasks,
    outputPaths: overrides.outputPaths || (() => paths),
    getStatus: async () => ({ status: "running" }),
    isFile:
      overrides.isFile ||
      (async (filePath) => !new Set(overrides.missingPaths || []).has(filePath)),
    taskRunner: {
      start: async (options) => calls.push(options),
    },
    configuration: {
      pythonPath: "D:\\runtime\\python.exe",
      coreScript: "D:\\workflow\\scripts\\merge_final_subtitles.py",
      logDirectory: "D:\\workflow\\data\\logs",
      workingDirectory: "D:\\workflow",
      environment: { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    },
  });
  return { activeTasks, calls, paths, workflow };
}

test("starts final subtitle merging through the shared task runner", async () => {
  const { activeTasks, calls, paths, workflow } = fixture();

  assert.deepEqual(await workflow.start({ id: "video-1" }), { status: "running" });
  const options = calls[0];
  assert.equal(options.videoId, "video-1");
  assert.equal(options.workflow, "final-subtitles");
  assert.equal(options.activeTasks, activeTasks);
  assert.equal(options.command, "D:\\runtime\\python.exe");
  assert.deepEqual(options.arguments, [
    "D:\\workflow\\scripts\\merge_final_subtitles.py",
    "--speaker-srt",
    paths.inputs.speakerSrt,
    "--ocr-srt",
    paths.inputs.ocrSrt,
    "--output-dir",
    paths.outputDirectory,
    "--video-stem",
    paths.videoStem,
  ]);
  assert.equal(options.failureMessage(4), "中文字幕合并退出码：4");
  assert.equal(
    options.startFailureMessage(new Error("ENOENT")),
    "中文字幕合并启动失败：ENOENT",
  );
});

test("reports every missing subtitle input before starting", async () => {
  const missingPaths = ["D:\\project\\speakers.srt", "D:\\project\\ocr.srt"];
  const { calls, workflow } = fixture({ missingPaths });

  await assert.rejects(
    () => workflow.start({ id: "video-2" }),
    /合并所需字幕尚未齐全：D:\\project\\speakers\.srt；D:\\project\\ocr\.srt/,
  );
  assert.deepEqual(calls, []);
});

test("returns current status when subtitle merging is already running", async () => {
  const { activeTasks, calls, workflow } = fixture();
  activeTasks.set("video-3", { status: "running" });

  assert.deepEqual(await workflow.start({ id: "video-3" }), { status: "running" });
  assert.deepEqual(calls, []);
});

test("reports a missing merge script", async () => {
  const coreScript = "D:\\workflow\\scripts\\merge_final_subtitles.py";
  const { calls, workflow } = fixture({ missingPaths: [coreScript] });

  await assert.rejects(
    () => workflow.start({ id: "video-4" }),
    /找不到最终中文字幕合并脚本/,
  );
  assert.deepEqual(calls, []);
});
