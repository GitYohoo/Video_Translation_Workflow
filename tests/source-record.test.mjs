import assert from "node:assert/strict";
import test from "node:test";
import { applySelectedSourceToRecord } from "../server/source-record.js";

test("updates a project source path while preserving its workspace directory", () => {
  const record = {
    id: "video-1",
    name: "旧路径.mp4",
    sourcePath: "D:\\旧目录\\旧路径.mp4",
    size: 1024,
    type: "video/mp4",
    workspaceDirectory: "D:\\workspace\\video-1",
  };
  const incoming = {
    name: "新路径.mp4",
    sourcePath: "D:\\新目录\\新路径.mp4",
    size: 1024,
    type: "video/mp4",
  };

  const updated = applySelectedSourceToRecord(record, incoming, "D:\\projects");

  assert.equal(updated, record);
  assert.equal(record.name, "新路径.mp4");
  assert.equal(record.sourcePath, "D:\\新目录\\新路径.mp4");
  assert.equal(record.workspaceDirectory, "D:\\workspace\\video-1");
});

test("rejects replacement files that do not match the recorded size", () => {
  assert.throws(
    () =>
      applySelectedSourceToRecord(
        { id: "video-1", name: "原视频.mp4", size: 1024 },
        { name: "其他视频.mp4", sourcePath: "D:\\其他视频.mp4", size: 2048 },
        "D:\\projects",
      ),
    /大小与当前项目不一致/,
  );
});
