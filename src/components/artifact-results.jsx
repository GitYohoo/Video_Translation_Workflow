import { useState } from "react";
import { artifactDisplayName } from "../path-display.js";

export function FileResult({
  label,
  file,
  artifactKey,
  onOpen,
  readyText = "已生成",
  missingText = "待生成",
}) {
  const ready = Boolean(file?.ready);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState("");
  const fullPath = ready ? file.path : "";
  const displayName = ready ? artifactDisplayName(file) : "未生成";
  const openKey = artifactKey || file?.artifactKey;

  const copyPathWithTextarea = () => {
    const textarea = document.createElement("textarea");
    textarea.value = fullPath;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) {
      throw new Error("copy command failed");
    }
  };

  const copyPath = async () => {
    if (!fullPath) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(fullPath);
        } catch {
          copyPathWithTextarea();
        }
      } else {
        copyPathWithTextarea();
      }
      setCopyState("已复制");
      window.setTimeout(() => setCopyState(""), 1200);
    } catch {
      setCopyState("复制失败");
      window.setTimeout(() => setCopyState(""), 1600);
    }
  };

  return (
    <div className={`result-line ${ready ? "ready" : ""}`}>
      <strong className="result-label">{label}</strong>
      <span className={`artifact-name ${ready ? "" : "empty-path"}`} title={fullPath || displayName}>
        {displayName}
      </span>
      <span className="result-actions">
        <small>{ready ? readyText : missingText}</small>
        {ready && openKey && (
          <button className="open-path-button" type="button" onClick={() => onOpen(openKey)}>
            打开
          </button>
        )}
        {ready && (
          <>
            <button className="open-path-button" type="button" onClick={copyPath}>
              {copyState || "复制路径"}
            </button>
            <button
              className="open-path-button"
              type="button"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "收起路径" : "显示路径"}
            </button>
          </>
        )}
      </span>
      {ready && expanded && <code className="artifact-full-path">{fullPath}</code>}
    </div>
  );
}

export function DirectoryResult({ label, directory, path, ready, artifactKey, onOpen }) {
  const artifact = directory || { path, ready };
  return (
    <FileResult
      artifactKey={artifactKey || artifact.artifactKey}
      file={artifact}
      label={label}
      onOpen={onOpen}
      readyText="已就绪"
    />
  );
}

export function DubbingProgress({ progress }) {
  if (!progress?.ready && !progress?.total) {
    return null;
  }
  const percent = Number.isFinite(progress.percent) ? progress.percent : 0;
  return (
    <div className="dubbing-progress">
      <div className="dubbing-progress-head">
        <strong>VoxCPM 配音进度</strong>
        <span>{progress.completed || 0} / {progress.total || 0} 段</span>
      </div>
      <div className="dubbing-progress-bar" aria-label="VoxCPM 配音进度">
        <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="dubbing-progress-meta">
        <span>{percent.toFixed(1)}%</span>
        {progress.currentAction && progress.currentSegment && (
          <span>
            {progress.currentAction}第 {String(progress.currentSegment).padStart(3, "0")} 段
          </span>
        )}
      </div>
    </div>
  );
}
