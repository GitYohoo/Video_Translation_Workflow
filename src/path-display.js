export function pathLeafName(pathValue) {
  if (!pathValue || typeof pathValue !== "string") {
    return "";
  }
  const normalized = pathValue.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

export function artifactDisplayName(artifact) {
  if (!artifact) {
    return "";
  }
  return artifact.displayName || pathLeafName(artifact.path);
}
