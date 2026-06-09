import assert from "node:assert/strict";
import test from "node:test";
import { createProjectPathResolver } from "../server/project-paths.js";

const resolver = createProjectPathResolver({
  uploadDirectory: "D:\\VideoTranslationWorkflow\\data\\uploads",
});

const record = {
  id: "video-1",
  name: "示例视频.mp4",
  sourcePath: "D:\\素材库\\短剧\\第一集\\示例视频.mp4",
  size: 1024,
  type: "video/mp4",
  createdAt: 1,
};

test("derives stable artifact keys with display names", () => {
  const artifacts = resolver.projectArtifacts(record);

  assert.equal(artifacts["source.video"].displayName, "示例视频.mp4");
  assert.equal(artifacts["bsRoformer.outputDirectory"].displayName, "BS-RoFormer_二轨分离");
  assert.equal(artifacts["finalVideo.video"].displayName, "示例视频_英文配音_内嵌英文字幕.mp4");
  assert.equal(artifacts["finalVideo.video"].kind, "file");
  assert.equal(artifacts["finalVideo.outputDirectory"].kind, "directory");
});

test("looks up artifacts by key and rejects unknown keys", () => {
  const mixedTrack = resolver.artifactForKey(record, "englishDubbing.mixedTrack");

  assert.equal(mixedTrack.key, "englishDubbing.mixedTrack");
  assert.match(mixedTrack.path, /示例视频_英文成片混音_MX\+FX\.wav$/);
  assert.throws(
    () => resolver.artifactForKey(record, "unknown.output"),
    /未知项目产物/,
  );
});

test("resolves artifact paths for open actions", () => {
  const videoPath = resolver.artifactPathForKey(record, "finalVideo.video");

  assert.match(videoPath, /示例视频_英文配音_内嵌英文字幕\.mp4$/);
  assert.throws(
    () => resolver.artifactPathForKey(record, "not.real"),
    /未知项目产物/,
  );
});

test("keeps legacy copied videos addressable through upload directory", () => {
  const legacyRecord = {
    id: "legacy-1",
    name: "legacy.mp4",
    fileName: "stored-video.mp4",
    size: 2048,
    type: "video/mp4",
    createdAt: 2,
  };

  assert.equal(
    resolver.sourceFilePath(legacyRecord),
    "D:\\VideoTranslationWorkflow\\data\\uploads\\stored-video.mp4",
  );
  assert.deepEqual(resolver.projectArtifacts(legacyRecord), {});
});
