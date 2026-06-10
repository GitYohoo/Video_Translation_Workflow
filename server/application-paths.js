import path from "node:path";

export function resolveApplicationPaths({
  serverDirectory,
  environment = process.env,
}) {
  const applicationRoot = path.resolve(
    environment.VIDEO_TRANSLATION_APP_ROOT || path.resolve(serverDirectory, ".."),
  );
  const dataDirectory = path.resolve(
    environment.VIDEO_TRANSLATION_DATA_DIR || path.join(applicationRoot, "data"),
  );
  const runtimeDirectory = path.resolve(
    environment.VIDEO_TRANSLATION_RUNTIME_DIR || path.join(applicationRoot, ".runtime"),
  );

  return {
    applicationRoot,
    dataDirectory,
    runtimeDirectory,
    distDirectory: path.join(applicationRoot, "dist"),
    scriptsDirectory: path.join(applicationRoot, "scripts"),
  };
}
