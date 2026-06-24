import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readDubbingSegments,
  updateDubbingSegmentManifest,
} from "../server/dubbing-segment-editor.js";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dubbing-segments-"));
  const workDirectory = path.join(root, "英文配音分段");
  const dubbingDirectory = path.join(workDirectory, "VoxCPM_英文配音");
  const clipsDirectory = path.join(workDirectory, "片段");
  const fittedDirectory = path.join(dubbingDirectory, "时长适配片段");
  const rawDirectory = path.join(dubbingDirectory, "原始合成");
  const referenceDirectory = path.join(dubbingDirectory, "参考音色");
  await fs.mkdir(clipsDirectory, { recursive: true });
  await fs.mkdir(fittedDirectory, { recursive: true });
  await fs.mkdir(rawDirectory, { recursive: true });
  await fs.mkdir(referenceDirectory, { recursive: true });
  await fs.writeFile(path.join(clipsDirectory, "001_ref.wav"), "");
  await fs.writeFile(path.join(clipsDirectory, "002_ref.wav"), "");
  await fs.writeFile(path.join(fittedDirectory, "001_role.wav"), "");
  await fs.writeFile(path.join(rawDirectory, "001_role.wav"), "");
  await fs.writeFile(path.join(referenceDirectory, "Role#001.wav"), "");
  const replacementReference = path.join(root, "replacement.wav");
  await fs.writeFile(replacementReference, "");
  const segmentManifestPath = path.join(workDirectory, "英文配音分段清单.csv");
  const dubbingManifestPath = path.join(dubbingDirectory, "VoxCPM_英文配音清单.csv");
  await fs.writeFile(
    segmentManifestPath,
    [
      "\uFEFF编号,原字幕编号,开始时间,结束时间,时长秒,说话人,段类型,保留原声,音频文件,保留原声文件,英文台词,合并原因",
      '1,1,"00:00:01,000","00:00:02,000",1.000,Role,tts,no,片段/001_ref.wav,,Hello there,',
      '2,2,"00:00:03,000","00:00:04,000",1.000,Other,tts,no,片段/002_ref.wav,,Second line,',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    dubbingManifestPath,
    [
      "\uFEFF编号,开始时间,结束时间,目标时长秒,角色,生成方式,参考音色,英文台词,原始合成,时长适配片段,保留原声片段,原始时长秒,变速系数",
      '1,"00:00:01,000","00:00:02,000",1.000,Role#001,tts,参考音色/Role#001.wav,Hello there,原始合成/001_role.wav,时长适配片段/001_role.wav,,1.100,1.1000',
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    replacementReference,
    paths: {
      segmentManifestPath,
      dubbingManifestPath,
      dubbingDirectory,
    },
  };
}

test("reads dubbing segment details with playable audio URLs", async () => {
  const { paths } = await makeFixture();

  const segments = await readDubbingSegments(paths, "video-1");

  assert.equal(segments.length, 2);
  assert.deepEqual(
    {
      number: segments[0].number,
      speaker: segments[0].speaker,
      text: segments[0].text,
      role: segments[0].role,
      speedFactor: segments[0].speedFactor,
      fittedReady: segments[0].fittedAudio.ready,
      referenceReady: segments[0].referenceAudio.ready,
    },
    {
      number: 1,
      speaker: "Role",
      text: "Hello there",
      role: "Role#001",
      speedFactor: "1.1000",
      fittedReady: true,
      referenceReady: true,
    },
  );
  assert.match(
    segments[0].fittedAudio.url,
    /\/api\/videos\/video-1\/workflow\/english-dubbing-mix\/segments\/1\/audio\?kind=fitted/,
  );
  assert.equal(segments[1].fittedAudio.ready, false);
});

test("updates a single segment manifest row for speaker, reference audio, and text", async () => {
  const { paths, replacementReference } = await makeFixture();

  const result = await updateDubbingSegmentManifest(paths, 1, {
    speaker: "New Role",
    referenceAudioPath: replacementReference,
    text: "Updated line",
  });

  assert.equal(result.segment.number, 1);
  assert.equal(result.segment.speaker, "New Role");
  assert.equal(result.segment.text, "Updated line");
  assert.equal(result.segment.sourceAudio.path, replacementReference);
  const content = await fs.readFile(paths.segmentManifestPath, "utf8");
  assert.match(content, /New Role/);
  assert.match(content, /Updated line/);
  assert.match(content, /replacement\.wav/);
});

test("rejects invalid segment edits", async () => {
  const { paths } = await makeFixture();

  await assert.rejects(
    () => updateDubbingSegmentManifest(paths, 1, { speaker: "", text: "ok" }),
    /说话人不能为空/,
  );
  await assert.rejects(
    () => updateDubbingSegmentManifest(paths, 1, { text: "" }),
    /英文台词不能为空/,
  );
  await assert.rejects(
    () => updateDubbingSegmentManifest(paths, 1, { referenceAudioPath: "D:\\missing.wav" }),
    /找不到参考音频/,
  );
});
