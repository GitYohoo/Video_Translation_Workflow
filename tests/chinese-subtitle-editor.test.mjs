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
    speaker: "旁白",
    text: "旧字幕",
  });
  assert.equal(result.cues[1].speaker, "");
});

test("saves speaker and edited text while preserving numbering and timecodes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  await saveChineseSubtitleFile(filePath, [
    { number: 1, speaker: "队长", text: "新字幕" },
    { number: 2, speaker: "", text: "修改后的第二条" },
  ]);

  const saved = await fs.readFile(filePath, "utf8");
  assert.match(saved, /00:00:01,000 --> 00:00:02,500\n\[队长\] 新字幕/);
  assert.match(saved, /00:00:03,000 --> 00:00:04,000\n修改后的第二条/);
});

test("saves an inserted Chinese subtitle cue", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  await saveChineseSubtitleFile(filePath, [
    {
      number: 1,
      start: "00:00:01,000",
      end: "00:00:02,500",
      speaker: "旁白",
      text: "旧字幕",
    },
    {
      number: 2,
      start: "00:00:02,600",
      end: "00:00:02,900",
      speaker: "",
      text: "手工新增中文字幕",
    },
    {
      number: 3,
      start: "00:00:03,000",
      end: "00:00:04,000",
      speaker: "",
      text: "第二条",
    },
  ]);

  const saved = await fs.readFile(filePath, "utf8");
  assert.match(saved, /2\n00:00:02,600 --> 00:00:02,900\n手工新增中文字幕/);
  assert.match(saved, /3\n00:00:03,000 --> 00:00:04,000\n第二条/);
});

test("allows empty edited text and keeps the cue readable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  await saveChineseSubtitleFile(filePath, [
    { number: 1, speaker: "旁白", text: "" },
    { number: 2, speaker: "", text: "第二条" },
  ]);

  const result = await readChineseSubtitleFile(filePath);
  assert.equal(result.cues[0].speaker, "旁白");
  assert.equal(result.cues[0].text, "");
  assert.equal(result.cues[1].text, "第二条");
});

test("rejects missing edited cues", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chinese-editor-"));
  const filePath = path.join(directory, "示例_最终中文字幕.srt");
  await fs.writeFile(filePath, sample, "utf8");

  await assert.rejects(
    () => saveChineseSubtitleFile(filePath, [{ number: 1, text: "只提交一条" }]),
    /字幕条目数量不一致/,
  );
});

test("the route protects the master subtitles while English dubbing is running", async () => {
  const serverSource = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(
    serverSource,
    /activeEnglishDubbingTasks\.get\(video\.id\)\?\.status === "running"[\s\S]+英文配音正在运行/,
  );
});

test("translation editing accepts empty Chinese master subtitle text", async () => {
  const serverSource = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const parserSource = serverSource.slice(
    serverSource.indexOf("function parseEditableSubtitleDocument"),
    serverSource.indexOf("function parseTranslatedSubtitleTextDocument"),
  );

  assert.match(parserSource, /lines\.length < 2/);
  assert.doesNotMatch(parserSource, /没有字幕正文/);
});
