import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readChineseSubtitleFile,
  saveChineseSubtitleFile,
} from "../server/chinese-subtitle-editor.js";

const sample = "\uFEFF1\n00:00:01,000 --> 00:00:02,500\n[旁白] 旧字幕\n\n2\n00:00:03,000 --> 00:00:04,000\n第二条\n";

test("reads editable Chinese cues from the final SRT", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  const result = await readChineseSubtitleFile(filePath);

  assert.equal(result.cues.length, 2);
  assert.deepEqual(result.cues[0], {
    number: 1,
    start: "00:00:01,000",
    end: "00:00:02,500",
    startMs: 1000,
    endMs: 2500,
    text: "[旁白] 旧字幕",
  });
});

test("saves edited text while preserving numbering and timecodes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  await saveChineseSubtitleFile(filePath, [
    { number: 1, text: "[旁白] 新字幕" },
    { number: 2, text: "修改后的第二条" },
  ]);

  const saved = await fs.readFile(filePath, "utf8");
  assert.match(saved, /00:00:01,000 --> 00:00:02,500\n\[旁白\] 新字幕/);
  assert.match(saved, /00:00:03,000 --> 00:00:04,000\n修改后的第二条/);
});

test("rejects missing or empty edited cues", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  await assert.rejects(
    () => saveChineseSubtitleFile(filePath, [{ number: 1, text: "只提交一条" }]),
    /字幕条目数量不一致/,
  );
  await assert.rejects(
    () => saveChineseSubtitleFile(filePath, [
      { number: 1, text: "" },
      { number: 2, text: "第二条" },
    ]),
    /第 1 条字幕正文不能为空/,
  );
});

test("the route protects the master subtitles while English dubbing is running", async () => {
  const serverSource = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(
    serverSource,
    /activeEnglishDubbingTasks\.get\(video\.id\)\?\.status === "running"[\s\S]+英文配音正在运行/,
  );
});
