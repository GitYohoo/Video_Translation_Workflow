import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveSubtitleEditor } from "../server/index.js";

test("saves edited timeline, Chinese text, and English subtitles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "subtitle-editor-save-"));
  const sourcePath = path.join(directory, "示例视频.mp4");
  const finalDirectory = path.join(directory, "最终中文字幕");
  const translationDirectory = path.join(directory, "示例视频_英文翻译字幕");
  const finalSrtPath = path.join(finalDirectory, "示例视频_最终中文字幕.srt");
  const englishSrtPath = path.join(translationDirectory, "示例视频_最终英文字幕.srt");

  await fs.writeFile(sourcePath, "", "utf8");
  await fs.mkdir(finalDirectory, { recursive: true });
  await fs.writeFile(
    finalSrtPath,
    "\uFEFF1\n00:00:01,000 --> 00:00:02,000\n[旧角色] 旧中文\n\n2\n00:00:03,000 --> 00:00:04,000\n第二条\n",
    "utf8",
  );

  await saveSubtitleEditor(
    { id: "video-1", sourcePath, fileName: "示例视频.mp4" },
    [
      {
        number: 1,
        start: "00:00:01,200",
        end: "00:00:02,400",
        role: "新角色",
        chinese: "新中文",
        english: "New English line.",
      },
      {
        number: 2,
        start: "00:00:03,100",
        end: "00:00:04,300",
        role: "",
        chinese: "修改后的第二条",
        english: "Updated second line.",
      },
    ],
  );

  const savedChinese = await fs.readFile(finalSrtPath, "utf8");
  const savedEnglish = await fs.readFile(englishSrtPath, "utf8");

  assert.match(savedChinese, /00:00:01,200 --> 00:00:02,400\n\[新角色\] 新中文/);
  assert.match(savedChinese, /00:00:03,100 --> 00:00:04,300\n修改后的第二条/);
  assert.match(savedEnglish, /00:00:01,200 --> 00:00:02,400\n\[新角色\] New English line\./);
  assert.match(savedEnglish, /00:00:03,100 --> 00:00:04,300\nUpdated second line\./);
});

test("saves an inserted bilingual subtitle cue", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "subtitle-editor-save-"));
  const sourcePath = path.join(directory, "示例视频.mp4");
  const finalDirectory = path.join(directory, "最终中文字幕");
  const translationDirectory = path.join(directory, "示例视频_英文翻译字幕");
  const finalSrtPath = path.join(finalDirectory, "示例视频_最终中文字幕.srt");
  const englishSrtPath = path.join(translationDirectory, "示例视频_最终英文字幕.srt");

  await fs.writeFile(sourcePath, "", "utf8");
  await fs.mkdir(finalDirectory, { recursive: true });
  await fs.writeFile(
    finalSrtPath,
    "\uFEFF1\n00:00:01,000 --> 00:00:02,000\n第一条\n\n2\n00:00:03,000 --> 00:00:04,000\n第二条\n",
    "utf8",
  );

  await saveSubtitleEditor(
    { id: "video-1", sourcePath, fileName: "示例视频.mp4" },
    [
      {
        number: 1,
        start: "00:00:01,000",
        end: "00:00:02,000",
        role: "",
        chinese: "第一条",
        english: "First line.",
      },
      {
        number: 2,
        start: "00:00:02,100",
        end: "00:00:02,800",
        role: "旁白",
        chinese: "手工新增双语字幕",
        english: "Manually inserted bilingual subtitle.",
      },
      {
        number: 3,
        start: "00:00:03,000",
        end: "00:00:04,000",
        role: "",
        chinese: "第二条",
        english: "Second line.",
      },
    ],
  );

  const savedChinese = await fs.readFile(finalSrtPath, "utf8");
  const savedEnglish = await fs.readFile(englishSrtPath, "utf8");

  assert.match(savedChinese, /2\n00:00:02,100 --> 00:00:02,800\n\[旁白\] 手工新增双语字幕/);
  assert.match(savedChinese, /3\n00:00:03,000 --> 00:00:04,000\n第二条/);
  assert.match(savedEnglish, /2\n00:00:02,100 --> 00:00:02,800\n\[旁白\] Manually inserted bilingual subtitle\./);
  assert.match(savedEnglish, /3\n00:00:03,000 --> 00:00:04,000\nSecond line\./);
});
