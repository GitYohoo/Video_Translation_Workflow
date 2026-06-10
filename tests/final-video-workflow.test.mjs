import assert from "node:assert/strict";
import test from "node:test";
import { createFinalVideoWorkflow } from "../server/workflows/final-video.js";

function fixture(overrides = {}) {
  const activeTasks = new Map();
  const calls = [];
  const paths = {
    inputs: {
      video: "D:\\project\\source.mp4",
      subtitle: "D:\\project\\english.srt",
      audio: "D:\\project\\english-mix.wav",
    },
    outputDirectory: "D:\\project\\最终英文成片",
  };
  const normalizedStyle = {
    fontName: "Segoe UI Semibold",
    fontSize: 50,
  };
  const workflow = createFinalVideoWorkflow({
    activeTasks,
    outputPaths: overrides.outputPaths || (() => paths),
    getDubbingStatus:
      overrides.getDubbingStatus || (async () => ({ status: "completed" })),
    getStatus: async () => ({ status: "running" }),
    isFile:
      overrides.isFile ||
      (async (filePath) => !new Set(overrides.missingPaths || []).has(filePath)),
    ensureDirectory: async (directory) => calls.push(["mkdir", directory]),
    normalizeStyle: (style) => {
      calls.push(["normalizeStyle", style]);
      return normalizedStyle;
    },
    saveStyle: (videoId, style) => calls.push(["saveStyle", videoId, style]),
    buildArguments: (receivedPaths, style) => {
      calls.push(["buildArguments", receivedPaths, style]);
      return ["render.py", "--output-dir", receivedPaths.outputDirectory];
    },
    taskRunner: {
      start: async (options) => calls.push(["start", options]),
    },
    configuration: {
      pythonPath: "D:\\runtime\\python.exe",
      coreScript: "D:\\workflow\\scripts\\render_english_video.py",
      ffmpegPath: "D:\\tools\\ffmpeg.exe",
      logDirectory: "D:\\workflow\\data\\logs",
      workingDirectory: "D:\\workflow",
      environment: { PYTHONUTF8: "1" },
    },
  });
  return { activeTasks, calls, normalizedStyle, paths, workflow };
}

test("starts final video rendering through the shared task runner", async () => {
  const { activeTasks, calls, normalizedStyle, paths, workflow } = fixture();
  const requestedStyle = { fontSize: 60 };

  assert.deepEqual(await workflow.start({ id: "video-1" }, requestedStyle), {
    status: "running",
  });
  assert.deepEqual(calls.slice(0, 4), [
    ["normalizeStyle", requestedStyle],
    ["saveStyle", "video-1", normalizedStyle],
    ["mkdir", paths.outputDirectory],
    ["buildArguments", paths, normalizedStyle],
  ]);
  const options = calls[4][1];
  assert.equal(options.videoId, "video-1");
  assert.equal(options.workflow, "final-video");
  assert.equal(options.activeTasks, activeTasks);
  assert.equal(options.command, "D:\\runtime\\python.exe");
  assert.deepEqual(options.arguments, [
    "render.py",
    "--output-dir",
    paths.outputDirectory,
  ]);
  assert.equal(options.failureMessage(5), "最终成片退出码：5");
  assert.equal(
    options.startFailureMessage(new Error("ENOENT")),
    "最终成片启动失败：ENOENT",
  );
});

test("requires a completed and current English dubbing mix", async () => {
  const { calls, workflow } = fixture({
    getDubbingStatus: async () => ({ status: "ready" }),
  });

  await assert.rejects(
    () => workflow.start({ id: "video-2" }, {}),
    /请先重新执行英文配音与混音/,
  );
  assert.deepEqual(calls, []);
});

test("reports all missing final video inputs", async () => {
  const missingPaths = ["D:\\project\\english.srt", "D:\\project\\english-mix.wav"];
  const { calls, workflow } = fixture({ missingPaths });

  await assert.rejects(
    () => workflow.start({ id: "video-3" }, {}),
    /最终成片所需输入尚未齐全：D:\\project\\english\.srt；D:\\project\\english-mix\.wav/,
  );
  assert.deepEqual(calls, []);
});

test("returns current status without replacing style for a duplicate task", async () => {
  const { activeTasks, calls, workflow } = fixture();
  activeTasks.set("video-4", { status: "running" });

  assert.deepEqual(await workflow.start({ id: "video-4" }, { fontSize: 72 }), {
    status: "running",
  });
  assert.deepEqual(calls, []);
});

test("reports a missing FFmpeg executable", async () => {
  const ffmpegPath = "D:\\tools\\ffmpeg.exe";
  const { calls, workflow } = fixture({ missingPaths: [ffmpegPath] });

  await assert.rejects(
    () => workflow.start({ id: "video-5" }, {}),
    /找不到FFmpeg 程序/,
  );
  assert.deepEqual(calls, []);
});
