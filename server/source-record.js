import { projectWorkspaceDirectory } from "./project-paths.js";

export function applySelectedSourceToRecord(record, incoming, workspaceRootDirectory) {
  if (record.size && incoming.size !== record.size) {
    throw new Error(
      `所选文件大小与当前项目不一致。请重新选择原视频：${record.name || "当前项目"}`,
    );
  }
  record.name = incoming.name;
  record.sourcePath = incoming.sourcePath;
  record.size = incoming.size;
  record.type = incoming.type;
  record.workspaceDirectory =
    record.workspaceDirectory ||
    projectWorkspaceDirectory(incoming.sourcePath, record.id, workspaceRootDirectory);
  delete record.fileName;
  return record;
}
