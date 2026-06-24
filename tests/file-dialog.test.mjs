import assert from "node:assert/strict";
import test from "node:test";
import {
  audioFileDialogFilter,
  buildAudioFileDialogScript,
  buildVideoFileDialogScript,
  parseSelectedVideoPath,
  videoFileDialogFilter,
} from "../server/file-dialog.js";

test("builds a Windows video file dialog script with expected filters", () => {
  const script = buildVideoFileDialogScript();

  assert.match(script, /OpenFileDialog/);
  assert.match(script, /选择原视频文件/);
  assert.match(videoFileDialogFilter, /\*\.mp4/);
  assert.match(videoFileDialogFilter, /\*\.mkv/);
  assert.match(videoFileDialogFilter, /\*\.mov/);
});

test("builds a Windows audio file dialog script with WAV reference filters", () => {
  const script = buildAudioFileDialogScript();

  assert.match(script, /OpenFileDialog/);
  assert.match(script, /选择参考音频/);
  assert.match(audioFileDialogFilter, /\*\.wav/);
});

test("parses selected path from PowerShell output", () => {
  assert.equal(
    parseSelectedVideoPath("D:\\素材\\第一集.mp4\r\n"),
    "D:\\素材\\第一集.mp4",
  );
});

test("returns null when the user cancels file selection", () => {
  assert.equal(parseSelectedVideoPath("\r\n"), null);
  assert.equal(parseSelectedVideoPath(""), null);
});
