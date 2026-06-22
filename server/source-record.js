export function applySelectedSourceToRecord(record, incoming) {
  if (record.size && incoming.size !== record.size) {
    throw new Error(
      `所选文件大小与当前项目不一致。请重新选择原视频：${record.name || "当前项目"}`,
    );
  }
  record.name = incoming.name;
  record.sourcePath = incoming.sourcePath;
  record.size = incoming.size;
  record.type = incoming.type;
  delete record.workspaceDirectory;
  delete record.fileName;
  return record;
}
