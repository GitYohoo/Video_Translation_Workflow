import assert from "node:assert/strict";
import test from "node:test";
import { createWhisperxWorkflow } from "../server/workflows/whisperx.js";

function fixture(overrides = {}) {
  const activeTasks = new Map();
  const calls = [];
  const paths = {
    inputPath: "D:\\project\\BS-RoFormer_二轨分离\\输出音轨\\dialogue.wav",
  };
  const workflow = createWhisperxWorkflow({
    activeTasks,
    outputPaths: overrides.outputPaths || (() => paths),
    getStatus: async () => ({ status: "running" }),
    isFile:
      overrides.isFile ||
      (async (filePath) => filePath !== overrides.missingPath),
    ensureDirectory: async (directory) => calls.push(["mkdir", directory]),
    taskRunner: {
      start: async (options) => calls.push(["start", options]),
    },
    configuration: {
      pythonPath: "D:\\runtime\\whisperx\\python.exe",
      coreScript: "D:\\workflow\\scripts\\whisperx_speaker_subtitles.py",
      tokenPath: "D:\\secrets\\huggingface-token.txt",
      ffmpegPath: "D:\\tools\\ffmpeg.exe",
      runtimeDirectory: "D:\\workflow\\.runtime",
      temporaryDirectory: "D:\\workflow\\.runtime\\tmp",
      modelDirectory: "D:\\workflow\\.runtime\\whisperx-models",
      logDirectory: "D:\\workflow\\data\\logs",
      workingDirectory: "D:\\workflow",
      environment: { PYTHONUTF8: "1" },
    },
  });
  return { activeTasks, calls, paths, workflow };
}

test("starts WhisperX through the shared task runner", async () => {
  const { activeTasks, calls, paths, workflow } = fixture();
  const status = await workflow.start({ id: "video-1" });

  assert.deepEqual(status, { status: "running" });
  assert.deepEqual(calls.slice(0, 2), [
    ["mkdir", "D:\\workflow\\.runtime\\tmp"],
    ["mkdir", "D:\\workflow\\.runtime\\whisperx-models"],
  ]);
  const options = calls[2][1];
  assert.equal(options.videoId, "video-1");
  assert.equal(options.workflow, "whisperx-speakers");
  assert.equal(options.activeTasks, activeTasks);
  assert.equal(options.command, "D:\\runtime\\whisperx\\python.exe");
  assert.deepEqual(options.arguments, [
    "D:\\workflow\\scripts\\whisperx_speaker_subtitles.py",
    "--audio",
    paths.inputPath,
    "--runtime-dir",
    "D:\\workflow\\.runtime",
    "--token-file",
    "D:\\secrets\\huggingface-token.txt",
    "--model",
    "large-v3",
    "--batch-size",
    "4",
  ]);
  assert.equal(options.failureMessage(3), "WhisperX 处理退出码：3");
  assert.equal(
    options.startFailureMessage(new Error("ENOENT")),
    "WhisperX 启动失败：ENOENT",
  );
});

test("requires the separated dialogue track", async () => {
  const missing = fixture({
    missingPath: "D:\\project\\BS-RoFormer_二轨分离\\输出音轨\\dialogue.wav",
  });

  await assert.rejects(() => missing.workflow.start({ id: "video-2" }), /未生成 DX 对白轨/);
  assert.deepEqual(missing.calls, []);
});

test("returns current status without starting a duplicate task", async () => {
  const { activeTasks, calls, workflow } = fixture();
  activeTasks.set("video-3", { status: "running" });

  assert.deepEqual(await workflow.start({ id: "video-3" }), { status: "running" });
  assert.deepEqual(calls, []);
});

test("reports a missing Hugging Face token", async () => {
  const missingPath = "D:\\secrets\\huggingface-token.txt";
  const { calls, workflow } = fixture({ missingPath });

  await assert.rejects(
    () => workflow.start({ id: "video-4" }),
    /找不到Hugging Face 访问令牌/,
  );
  assert.deepEqual(calls, []);
});
