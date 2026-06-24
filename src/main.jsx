import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  CheckCircle2,
  Clapperboard,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Play,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { artifactDisplayName, pathLeafName } from "./path-display.js";
import {
  clampSubtitleFontSize,
  clampSubtitlePosition,
  fontSizeFromResize,
  subtitlePreviewFontSize,
  subtitlePositionFromDrag,
  subtitlePositionStyle,
} from "./final-video-style.js";
import {
  buildSimplifiedWorkflowOverview,
  hasAutomaticWorkflowProgress,
  nextAutomaticActions,
  summarizeAutomaticWorkflow,
} from "./simplified-workflow.js";
import { buildWorkflowOverview, workflowStageGroups } from "./workflow-summary.js";
import "./styles.css";

const defaultFinalVideoStyle = {
  fontName: "Segoe UI Semibold",
  fontSize: 50,
  textColor: "#FFFFFF",
  backgroundColor: "#101010",
  backgroundOpacity: 1,
  positionX: 50,
  positionY: 84,
};
const workflowStageById = Object.fromEntries(
  workflowStageGroups.map((group) => [group.id, group]),
);

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "请求处理失败。");
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function speakerToneClass(speaker = "") {
  const text = String(speaker || "未标注");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 6;
  }
  return `speaker-tone-${hash}`;
}

function dubbingSegmentDraftFrom(segment) {
  if (!segment) {
    return null;
  }
  return {
    number: segment.number,
    speaker: segment.speaker || "",
    referenceAudioPath: segment.sourceAudio?.path || segment.referenceAudio?.path || "",
    referenceAudioName: pathLeafName(segment.referenceAudio?.path || segment.sourceAudio?.path || ""),
    text: segment.text || "",
  };
}

function buildTranslationPrompt(chineseSrtPath, geminiJsonPath) {
  if (!chineseSrtPath || !geminiJsonPath) {
    return "";
  }
  return `你是一名专业的影视字幕翻译师和英文配音脚本统筹。请读取以下中文字幕 SRT 文件，将字幕正文翻译成自然、简洁、适合英文配音的英文，并将结果写入指定 JSON 文件。

输入文件：
${chineseSrtPath}

输出文件：
${geminiJsonPath}

要求：
1. 输出文件必须是纯 JSON，不要输出 Markdown、解释、标题或代码块。
2. JSON 必须包含 display_subtitles 和 dubbing_groups 两个数组。
3. display_subtitles 用于画面显示，必须保持输入 SRT 的编号、起止时间、条数和顺序，不得合并、拆分或改动时间轴。
4. display_subtitles 的 text 只翻译字幕正文；若原文包含开头角色标签，例如 [黑猫]，必须保留角色标签，仅翻译其后的台词。
5. dubbing_groups 是后续英文 TTS 的“整句分段建议”，用于把被字幕切碎的同一句话合成一个配音分段。
6. 不要因为同一说话人连续说话就合并多句话；只能合并构成同一个完整句子或同一个不可拆台词单元的相邻字幕。
7. 不得跨说话人合并。说话人变化、完整句结束、语义转折、明显停顿或新动作反应都必须断开。
8. 极短语气词、承接词、半句，例如 Oh, Uh, Um..., Hmph, Thanks.，只有在它属于同一句完整台词时才并入相邻字幕。
9. 每个 dubbing_group 的目标是“一次 TTS 朗读一句完整英文对白”，不是减少段数。
10. dubbing_groups 必须完整覆盖所有 display_subtitles，每条显示字幕只能出现一次。
11. dubbing_groups 的 start 取第一条字幕开始时间，end 取最后一条字幕结束时间；后续会按这个整句时间窗切割原始 DX 对白轨作为参考音色。
12. dubbing_groups 的 text 要适合 TTS 一次性朗读，可在不改变意思的前提下合并标点和轻微润色。
13. 对每个 segment_type 为 tts 的 dubbing_group 必须判断英文配音语速，计算公式为：英文词数 ÷ 可用秒数 × 60 = WPM。
14. 可用秒数是该 dubbing_group 的 end 减去 start；英文词数只统计 text 中实际会朗读的英文单词。
15. WPM 必须控制在 90–190 WPM，优先保持在 90–180 WPM，尽量不超过 180 WPM；只有为了保留准确语义和自然表达确实无法再压缩时，才允许落在 181–190 WPM。
16. 如果 WPM 不在 90–190 范围内，必须修改英文译文：过快时用更简洁自然的表达，过慢时用更完整自然但不增加新事实的表达。修改时必须保留原有语境和意思、人物关系、语气、情绪与关键信息，不得曲解、遗漏或添加剧情。
17. 修改译文后必须重新计算 WPM，持续调整到符合范围；同时保证 dubbing_groups 与对应 display_subtitles 的英文语义一致。每个 tts 类型的 dubbing_group 都要输出取整后的 wpm 数值。
18. segment_type 为 preserve_original 的非语言人声不参与 WPM 计算，其 wpm 写 null。
19. 对“哈哈哈、呵呵、大笑、冷笑、哭声、抽泣、喘息、喘气、尖叫、咳嗽、叹气”等非语言人声，不要翻译成可朗读对白，也不要写成 ha ha ha 给 TTS 朗读；这类条目的 segment_type 必须写 preserve_original。
20. 普通可朗读对白的 segment_type 必须写 tts。若一个 dubbing_group 内包含非语言人声并且没有实质台词，该 group 的 segment_type 必须是 preserve_original；如果非语言人声和实质台词混在一起，必须优先拆成相邻的 tts 与 preserve_original 两个 group。

JSON 格式：
{
  "display_subtitles": [
    {
      "index": 1,
      "start": "00:00:00,000",
      "end": "00:00:03,000",
      "speaker": "角色名或未标注",
      "segment_type": "tts 或 preserve_original",
      "text": "[角色名] English display subtitle text"
    }
  ],
  "dubbing_groups": [
    {
      "group_id": 1,
      "subtitle_indices": [1, 2, 3],
      "start": "00:00:00,000",
      "end": "00:00:05,800",
      "speaker": "角色名或未标注",
      "segment_type": "tts 或 preserve_original",
      "text": "A complete English sentence for one TTS pass.",
      "wpm": 124,
      "merge_reason": "Fragments 1-3 form one complete sentence."
    }
  ]
}`;
}

function FileResult({
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

function DirectoryResult({ label, directory, path, ready, artifactKey, onOpen }) {
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

function DubbingProgress({ progress }) {
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

function formatTimelineSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remainder}`;
}

function mergeTimelineRanges(ranges) {
  return [...ranges]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}

function VideoThumbnail({ video }) {
  return (
    <img
      className="video-thumbnail"
      alt=""
      aria-hidden="true"
      decoding="async"
      loading="lazy"
      src={video.thumbnailUrl}
    />
  );
}

function ProjectWorkflowOverview({ overview, nextDisabled, onRunNext, onStepSelect, selectedStepId }) {
  const nextAction = overview.nextAction;
  return (
    <section className="workflow-overview" aria-label="项目进度总览">
      <div className="overview-copy">
        <p className="eyebrow">项目进度</p>
        <h2>{overview.headline}</h2>
        <p>{overview.detail}</p>
        <div className="overview-meter" aria-label={`主流程完成 ${overview.percent}%`}>
          <span style={{ width: `${overview.percent}%` }} />
        </div>
        <small>
          已完成 {overview.completedCount} / {overview.totalCount} 个主阶段
        </small>
      </div>
      <div className="overview-action">
        {nextAction ? (
          <button
            className="primary-button overview-next-button"
            disabled={nextDisabled || nextAction.disabled}
            type="button"
            onClick={onRunNext}
          >
            {nextAction.label}
          </button>
        ) : (
          <strong className="overview-complete">主流程已完成</strong>
        )}
      </div>
      <ol className="overview-steps">
        {overview.steps.map((step) => (
          <li
            key={step.id}
            className={`overview-step ${step.state} ${selectedStepId === (step.panelId || step.id) ? "active" : ""}`}
          >
            <button type="button" onClick={() => onStepSelect(step.panelId || step.id)}>
              <span className="overview-step-index">{String(step.index).padStart(2, "0")}</span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.label}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DubbingSegmentEditorPanel({
  segments,
  selectedSegment,
  draft,
  message,
  versionKey,
  disabled,
  busy,
  onSelect,
  onDraftChange,
  onChooseReferenceAudio,
  onRegenerate,
}) {
  if (!segments.length) {
    return null;
  }
  return (
    <>
      {message && <p className="workflow-message">{message}</p>}
      <section className="dubbing-segment-editor" aria-label="配音条目编辑器">
        <div className="dubbing-segment-list-panel">
          <div className="segment-panel-heading">
            <strong>配音条目</strong>
            <span>{segments.length} 条</span>
          </div>
          <div className="dubbing-segment-list">
            {segments.map((segment) => (
              <button
                className={`dubbing-segment-row ${speakerToneClass(segment.speaker)} ${
                  segment.number === selectedSegment?.number ? "active" : ""
                }`}
                key={segment.number}
                type="button"
                onClick={() => onSelect(segment)}
              >
                <span className={`segment-number ${speakerToneClass(segment.speaker)}`}>
                  {segment.displayNumber}
                </span>
                <span className="segment-main">
                  <strong>{segment.speaker}</strong>
                  <small>
                    {segment.start} - {segment.end}
                  </small>
                  <span>{segment.text}</span>
                </span>
                <span className={`segment-ready ${segment.fittedAudio?.ready ? "ready" : "missing"}`}>
                  {segment.fittedAudio?.ready ? "可试听" : "未生成"}
                </span>
              </button>
            ))}
          </div>
        </div>
        {selectedSegment && draft && (
          <div className="dubbing-segment-detail">
            <div className="segment-panel-heading">
              <strong>配音详情</strong>
              <span>第 {selectedSegment.displayNumber} 条</span>
            </div>
            <div className="segment-detail-grid">
              <span>时间段</span>
              <strong>
                {selectedSegment.start} - {selectedSegment.end}
              </strong>
              <span>目标时长</span>
              <strong>{selectedSegment.durationSeconds || "-"} 秒</strong>
              <span>生成角色</span>
              <strong>{selectedSegment.role || "未生成"}</strong>
              <span>变速系数</span>
              <strong>{selectedSegment.speedFactor || "-"}</strong>
            </div>
            {selectedSegment.fittedAudio?.ready && (
              <label className="segment-audio-player">
                <span>当前配音试听</span>
                <audio
                  controls
                  preload="none"
                  src={`${selectedSegment.fittedAudio.url}&v=${versionKey || ""}`}
                />
              </label>
            )}
            <div className="segment-audio-player reference-audio-player">
              <span>参考音频试听</span>
              {selectedSegment.referenceAudio?.ready ? (
                <audio
                  controls
                  preload="none"
                  src={`${selectedSegment.referenceAudio.url}&v=${versionKey || ""}`}
                />
              ) : (
                <small>未找到参考音频</small>
              )}
              <button
                className="secondary-button compact"
                disabled={disabled || busy}
                type="button"
                onClick={onChooseReferenceAudio}
              >
                更改参考音频
              </button>
              {draft.referenceAudioName && (
                <small className="reference-audio-name">已选：{draft.referenceAudioName}</small>
              )}
            </div>
            <div className="segment-edit-grid">
              <label>
                <span>说话人</span>
                <input
                  type="text"
                  value={draft.speaker}
                  onChange={(event) => onDraftChange({ ...draft, speaker: event.target.value })}
                />
              </label>
              <label className="segment-text-field">
                <span>配音内容</span>
                <textarea
                  rows={4}
                  value={draft.text}
                  onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
                />
              </label>
            </div>
            <button
              className="primary-button workflow-action"
              disabled={disabled || busy}
              type="button"
              onClick={onRegenerate}
            >
              {busy ? "正在提交..." : "重新配音该条并合成整轨"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function WorkflowStageSection({ group, children }) {
  return (
    <section className={`workflow-stage workflow-stage-${group.id}`} aria-labelledby={`stage-${group.id}`}>
      <header className="workflow-stage-heading">
        <p className="eyebrow">{group.eyebrow}</p>
        <h2 id={`stage-${group.id}`}>{group.title}</h2>
        <p>{group.description}</p>
      </header>
      <div className="workflow-stage-grid">{children}</div>
    </section>
  );
}

function CancelTaskButton({ visible, busy, onClick }) {
  if (!visible) {
    return null;
  }
  return (
    <button
      className="secondary-button workflow-cancel-action"
      disabled={busy}
      type="button"
      onClick={onClick}
    >
      {busy ? "正在取消..." : "取消任务"}
    </button>
  );
}

function SubtitlePreviewFigure({
  preview,
  previewVersion,
  previewText,
  style,
  onStyleChange,
}) {
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const interactionRef = useRef(null);
  const draftStyleRef = useRef(null);
  const [interactionMode, setInteractionMode] = useState("");
  const [draftStyle, setDraftStyle] = useState(null);
  const [sourceHeight, setSourceHeight] = useState(1080);
  const [displayHeight, setDisplayHeight] = useState(0);
  const effectiveStyle = draftStyle || style;
  const position = subtitlePositionStyle(
    effectiveStyle.positionX,
    effectiveStyle.positionY,
  );
  const previewFontSize = subtitlePreviewFontSize(
    effectiveStyle.fontSize,
    displayHeight,
    sourceHeight,
  );
  const backgroundAlpha = Math.round(
    Math.min(1, Math.max(0, Number(effectiveStyle.backgroundOpacity))) * 255,
  )
    .toString(16)
    .padStart(2, "0");

  const updateImageMeasurements = useCallback(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }
    setSourceHeight(image.naturalHeight || 1080);
    setDisplayHeight(image.clientHeight);
  }, []);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(updateImageMeasurements);
    observer.observe(image);
    return () => observer.disconnect();
  }, [updateImageMeasurements]);

  const stopInteraction = useCallback((event) => {
    if (!interactionRef.current) {
      return;
    }
    interactionRef.current = null;
    setInteractionMode("");
    if (draftStyleRef.current) {
      onStyleChange(draftStyleRef.current);
    }
    draftStyleRef.current = null;
    setDraftStyle(null);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can already be gone after cancellation.
    }
  }, [onStyleChange]);

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== 0) {
        return;
      }
      const frame = frameRef.current;
      if (!frame) {
        return;
      }
      event.preventDefault();
      draftStyleRef.current = { ...style };
      setDraftStyle({ ...style });
      const resizeHandle = event.target.closest?.("[data-resize-handle]");
      if (resizeHandle) {
        const boxRect = event.currentTarget.getBoundingClientRect();
        const centerX = boxRect.left + boxRect.width / 2;
        const centerY = boxRect.top + boxRect.height / 2;
        interactionRef.current = {
          mode: "resize",
          centerX,
          centerY,
          startDistance: Math.hypot(event.clientX - centerX, event.clientY - centerY),
          startFontSize: style.fontSize,
        };
        setInteractionMode("resize");
      } else {
        interactionRef.current = {
          mode: "drag",
          startPosition: {
            positionX: style.positionX,
            positionY: style.positionY,
          },
          startPointer: {
            clientX: event.clientX,
            clientY: event.clientY,
          },
        };
        setInteractionMode("drag");
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [style.fontSize, style.positionX, style.positionY],
  );

  const handlePointerMove = useCallback(
    (event) => {
      const interaction = interactionRef.current;
      const frame = frameRef.current;
      if (!interaction || !frame) {
        return;
      }
      event.preventDefault();
      if (interaction.mode === "drag") {
        const nextPosition = subtitlePositionFromDrag(
          interaction.startPosition,
          interaction.startPointer,
          { clientX: event.clientX, clientY: event.clientY },
          frame.getBoundingClientRect(),
        );
        const nextStyle = { ...(draftStyleRef.current || style), ...nextPosition };
        draftStyleRef.current = nextStyle;
        setDraftStyle(nextStyle);
        return;
      }
      const currentDistance = Math.hypot(
        event.clientX - interaction.centerX,
        event.clientY - interaction.centerY,
      );
      const nextStyle = {
        ...(draftStyleRef.current || style),
        fontSize: fontSizeFromResize(
          interaction.startFontSize,
          interaction.startDistance,
          currentDistance,
        ),
      };
      draftStyleRef.current = nextStyle;
      setDraftStyle(nextStyle);
    },
    [style],
  );

  const handleKeyDown = useCallback(
    (event) => {
      const step = event.shiftKey ? 2 : 0.5;
      const positionChanges = {
        ArrowLeft: { positionX: clampSubtitlePosition(style.positionX - step) },
        ArrowRight: { positionX: clampSubtitlePosition(style.positionX + step) },
        ArrowUp: { positionY: clampSubtitlePosition(style.positionY - step) },
        ArrowDown: { positionY: clampSubtitlePosition(style.positionY + step) },
      };
      if (event.key in positionChanges) {
        event.preventDefault();
        onStyleChange(positionChanges[event.key]);
        return;
      }
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        onStyleChange({
          fontSize: clampSubtitleFontSize(
            style.fontSize + (event.key === "-" ? -2 : 2),
          ),
        });
      }
    },
    [onStyleChange, style.fontSize, style.positionX, style.positionY],
  );

  return (
    <figure className="subtitle-editor-preview">
      <div className={`subtitle-preview-frame ${interactionMode ? "interacting" : ""}`}>
        <div
          ref={frameRef}
          className="subtitle-preview-canvas"
        >
          <img
            ref={imageRef}
            alt="字幕位置编辑参考帧"
            src={`${preview.url}?v=${previewVersion}`}
            onLoad={updateImageMeasurements}
          />
          {interactionMode && (
            <>
              <span className="subtitle-canvas-guide vertical" style={{ left: position.left }} />
              <span className="subtitle-canvas-guide horizontal" style={{ top: position.top }} />
            </>
          )}
          <div
            aria-label={`拖动字幕调整位置，拖动四角调整大小。当前位置横向 ${Math.round(effectiveStyle.positionX)}%，纵向 ${Math.round(effectiveStyle.positionY)}%，字号 ${effectiveStyle.fontSize}`}
            className={`subtitle-edit-box ${interactionMode || ""}`}
            role="button"
            tabIndex="0"
            title="拖动字幕移动；拖动四角调整大小"
            style={{
              ...position,
              backgroundColor: `${effectiveStyle.backgroundColor}${backgroundAlpha}`,
              color: effectiveStyle.textColor,
              fontFamily: effectiveStyle.fontName,
              fontSize: `${previewFontSize}px`,
            }}
            onKeyDown={handleKeyDown}
            onPointerCancel={stopInteraction}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopInteraction}
          >
            <span className="subtitle-edit-text">{previewText}</span>
            {["nw", "ne", "sw", "se"].map((handle) => (
              <span
                aria-hidden="true"
                className={`subtitle-resize-handle ${handle}`}
                data-resize-handle={handle}
                key={handle}
              />
            ))}
          </div>
        </div>
      </div>
      <figcaption>
        直接拖动字幕放置位置，拖动四角调整大小；最终视频会直接采用这里的参数。
      </figcaption>
    </figure>
  );
}

function Sidebar({
  videos,
  isLoading,
  isAddingVideo,
  isDesktop,
  onAddPath,
  onDelete,
  onOpenSettings,
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Clapperboard size={20} strokeWidth={2.2} />
        </span>
        <span className="brand-copy">
          <strong className="brand-label">影译工坊</strong>
          <small>本地视频制作台</small>
        </span>
      </div>
      <button
        className="upload-button"
        disabled={isAddingVideo}
        type="button"
        onClick={onAddPath}
      >
        <FolderPlus aria-hidden="true" size={20} />
        <strong>{isAddingVideo ? "正在添加..." : "添加视频项目"}</strong>
      </button>
      <div className="sidebar-section-label">项目</div>
      <nav className="video-list" aria-label="视频项目">
        {isLoading && <p className="status-text">读取视频中...</p>}
        {!isLoading && videos.length === 0 && (
          <p className="status-text">选择第一个原视频开始工作流</p>
        )}
        {videos.map((video) => (
          <div className="video-entry" key={video.id}>
            <NavLink
              className={({ isActive }) => `video-item ${isActive ? "active" : ""}`}
              to={`/video/${video.id}`}
            >
              <VideoThumbnail video={video} />
              <span className="video-summary">
                <strong>{video.name}</strong>
                <small>{video.storageMode === "reference" ? "原路径" : "旧版副本"} · {formatSize(video.size)}</small>
              </span>
            </NavLink>
            <button
              className="delete-button"
              type="button"
              aria-label={`删除 ${video.name}`}
              title="从项目列表移除"
              onClick={() => onDelete(video.id)}
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          </div>
        ))}
      </nav>
      <footer className="sidebar-footer">
        {isDesktop && (
          <button className="sidebar-settings" type="button" onClick={onOpenSettings}>
            <Settings2 aria-hidden="true" size={17} />
            <span>应用设置</span>
          </button>
        )}
        <div className="local-status">
          <span aria-hidden="true" />
          <small>本地处理服务</small>
          <strong>已就绪</strong>
        </div>
      </footer>
    </aside>
  );
}

function WelcomePage({ videos, isAddingVideo, onAddPath }) {
  const recentVideos = videos.slice(0, 4);
  return (
    <main className="welcome-page">
      <div className="welcome-workbench">
        <header className="welcome-header">
          <div>
            <p className="eyebrow">项目工作台</p>
            <h1>从原视频开始制作</h1>
            <p className="welcome-copy">
              选择视频后点击开始，系统将自动提取、识别并合并最终中文字幕，原文件不会被复制。
            </p>
          </div>
          <button className="primary-button" disabled={isAddingVideo} type="button" onClick={onAddPath}>
            <FolderPlus aria-hidden="true" size={18} />
            {isAddingVideo ? "正在添加..." : "选择原视频"}
          </button>
        </header>

        <section className="workflow-start" aria-labelledby="workflow-start-title">
          <div className="workflow-start-icon"><Play aria-hidden="true" size={22} fill="currentColor" /></div>
          <div className="workflow-start-copy">
            <h2 id="workflow-start-title">一次点击完成字幕流程</h2>
            <p>点击开始后自动处理中间产物，完成后直接播放视频并校对最终字幕。</p>
          </div>
          <ol className="start-stages">
            <li><span>01</span><strong>点击开始生成</strong></li>
            <li><span>02</span><strong>播放与校对</strong></li>
          </ol>
        </section>

        <section className="recent-projects" aria-labelledby="recent-projects-title">
          <header>
            <div>
              <p className="eyebrow">最近项目</p>
              <h2 id="recent-projects-title">继续制作</h2>
            </div>
            <span>{videos.length} 个项目</span>
          </header>
          {recentVideos.length > 0 ? (
            <div className="recent-project-grid">
              {recentVideos.map((video) => (
                <NavLink className="recent-project" key={video.id} to={`/video/${video.id}`}>
                  <VideoThumbnail video={video} />
                  <span>
                    <strong>{video.name}</strong>
                    <small>{formatSize(video.size)} · 点击继续</small>
                  </span>
                  <Play aria-hidden="true" size={16} />
                </NavLink>
              ))}
            </div>
          ) : (
            <div className="empty-projects">
              <FolderOpen aria-hidden="true" size={25} />
              <div><strong>还没有项目</strong><small>选择一个原视频开始。</small></div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function DesktopTitlebar({ desktopInfo, onOpenSettings }) {
  return (
    <header className="desktop-titlebar">
      <div className="desktop-titlebar-brand">
        <Clapperboard aria-hidden="true" size={16} />
        <strong>影译工坊</strong>
      </div>
      <div className="desktop-titlebar-status">
        <span className={desktopInfo?.serviceUrl ? "ready" : "starting"} aria-hidden="true" />
        {desktopInfo?.serviceUrl ? "本地服务已就绪" : "正在启动服务"}
      </div>
      <button
        className="titlebar-settings"
        type="button"
        aria-label="打开应用设置"
        title="应用设置"
        onClick={onOpenSettings}
      >
        <Settings2 aria-hidden="true" size={16} />
      </button>
    </header>
  );
}

function DesktopSettingsDialog({ info, onClose, onOpenDirectory, onChooseRuntime }) {
  return (
    <div className="dialog-backdrop desktop-settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="desktop-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <p className="eyebrow">应用设置</p>
            <h2 id="desktop-settings-title">本机环境</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设置" title="关闭" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="settings-health">
          <CheckCircle2 aria-hidden="true" size={21} />
          <div><strong>应用服务运行正常</strong><small>版本 {info?.version || "0.2.0"} · 数据仅保存在本机</small></div>
        </div>

        <div className="settings-directory-list">
          <section className="settings-directory-row">
            <HardDrive aria-hidden="true" size={19} />
            <div><strong>项目数据</strong><code>{info?.dataDirectory || "正在读取..."}</code></div>
            <button className="secondary-button compact-button" type="button" onClick={() => onOpenDirectory("data")}>打开</button>
          </section>
          <section className="settings-directory-row">
            <HardDrive aria-hidden="true" size={19} />
            <div>
              <strong>处理运行环境</strong>
              <code>{info?.runtimeDirectory || "正在读取..."}</code>
              <small className={info?.runtimeReady ? "directory-ready" : "directory-warning"}>
                {info?.runtimeReady ? "目录可用" : "目录尚未准备"}
              </small>
            </div>
            <button className="secondary-button compact-button" type="button" onClick={() => onOpenDirectory("runtime")}>打开</button>
          </section>
        </div>

        <footer className="settings-dialog-actions">
          <p>切换运行环境后应用会自动重启。模型和 Python 环境不会复制到安装目录。</p>
          <button className="primary-button compact" type="button" onClick={onChooseRuntime}>
            <FolderOpen aria-hidden="true" size={17} />
            选择运行环境目录
          </button>
        </footer>
      </section>
    </div>
  );
}

function PathDialog({
  isSaving,
  isSelectingSource,
  value,
  onChange,
  onClose,
  onSelectSource,
  onSubmit,
}) {
  const isBusy = isSaving || isSelectingSource;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="path-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="path-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">添加视频项目</p>
        <h2 id="path-dialog-title">选择原视频</h2>
        <p className="dialog-copy">
          点击按钮打开系统文件选择窗口。应用只登记原视频位置，不复制视频文件。
        </p>
        <button
          autoFocus
          className="primary-button file-picker-button"
          disabled={isBusy}
          type="button"
          onClick={onSelectSource}
        >
          {isSelectingSource ? "等待选择..." : "选择视频文件"}
        </button>
        <details className="manual-path-fallback">
          <summary>高级方式：粘贴已有路径</summary>
          <label className="path-label" htmlFor="source-path">
            原视频绝对路径
          </label>
          <input
            className="path-input"
            id="source-path"
            placeholder="D:\视频素材\示例视频.mp4"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSubmit();
              }
            }}
          />
          <p className="path-hint">备用方式：从资源管理器复制文件路径后粘贴到这里。</p>
        </details>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button compact"
            disabled={isBusy || !value.trim()}
            type="button"
            onClick={onSubmit}
          >
            {isSaving ? "正在记录..." : "使用粘贴路径"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SimplifiedVideoPage({ videos, isLoading }) {
  const { videoId } = useParams();
  const videoRef = useRef(null);
  const inFlightActions = useRef(new Set());
  const [record, setRecord] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [separation, setSeparation] = useState(null);
  const [ocr, setOcr] = useState(null);
  const [speakers, setSpeakers] = useState(null);
  const [finalSubtitles, setFinalSubtitles] = useState(null);
  const [translationStatus, setTranslationStatus] = useState(null);
  const [downstreamEnglishDubbing, setDownstreamEnglishDubbing] = useState(null);
  const [downstreamFinalVideo, setDownstreamFinalVideo] = useState(null);
  const [downstreamFinalValidation, setDownstreamFinalValidation] = useState(null);
  const [workflowError, setWorkflowError] = useState("");
  const [editorCues, setEditorCues] = useState([]);
  const [editorOriginalCues, setEditorOriginalCues] = useState([]);
  const [editorError, setEditorError] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isReplacingSource, setIsReplacingSource] = useState(false);
  const [sourceReplaceMessage, setSourceReplaceMessage] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [openPathError, setOpenPathError] = useState("");
  const [workflowStarted, setWorkflowStarted] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState("generateChinese");
  const [deletingStage, setDeletingStage] = useState("");
  const [stageDeleteMessage, setStageDeleteMessage] = useState("");
  const [embeddedPanelVersion, setEmbeddedPanelVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const cached = videos.find((video) => video.id === videoId);
    if (cached) {
      setRecord(cached);
      setNotFound(false);
      return undefined;
    }
    if (!isLoading) {
      requestJson(`/api/videos/${videoId}`)
        .then((video) => active && setRecord(video))
        .catch(() => active && setNotFound(true));
    }
    return () => {
      active = false;
    };
  }, [isLoading, videoId, videos]);

  const refreshStatuses = useCallback(async () => {
    if (!record) {
      return;
    }
    const [
      nextSeparation,
      nextOcr,
      nextSpeakers,
      nextFinalSubtitles,
      nextTranslationStatus,
      nextEnglishDubbing,
      nextFinalVideo,
      nextFinalValidation,
    ] = await Promise.all([
      requestJson(`/api/videos/${record.id}/workflow/bs-roformer`),
      requestJson(`/api/videos/${record.id}/workflow/ocr-subtitles`),
      requestJson(`/api/videos/${record.id}/workflow/whisperx-speakers`),
      requestJson(`/api/videos/${record.id}/workflow/final-subtitles`),
      requestJson(`/api/videos/${record.id}/workflow/subtitle-editor`),
      requestJson(`/api/videos/${record.id}/workflow/english-dubbing-mix`),
      requestJson(`/api/videos/${record.id}/workflow/final-video`),
      requestJson(`/api/videos/${record.id}/workflow/final-validation`),
    ]);
    setSeparation(nextSeparation);
    setOcr(nextOcr);
    setSpeakers(nextSpeakers);
    setFinalSubtitles(nextFinalSubtitles);
    setTranslationStatus(nextTranslationStatus);
    setDownstreamEnglishDubbing(nextEnglishDubbing);
    setDownstreamFinalVideo(nextFinalVideo);
    setDownstreamFinalValidation(nextFinalValidation);
    if (hasAutomaticWorkflowProgress({
      separation: nextSeparation,
      ocr: nextOcr,
      speakers: nextSpeakers,
      finalSubtitles: nextFinalSubtitles,
    })) {
      setWorkflowStarted(true);
    }
  }, [record]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    setSeparation(null);
    setOcr(null);
    setSpeakers(null);
    setFinalSubtitles(null);
    setTranslationStatus(null);
    setDownstreamEnglishDubbing(null);
    setDownstreamFinalVideo(null);
    setDownstreamFinalValidation(null);
    setEditorCues([]);
    setEditorOriginalCues([]);
    setWorkflowStarted(false);
    setSelectedPanel("generateChinese");
    setWorkflowError("");
    setEditorError("");
    void refreshStatuses().catch((error) => setWorkflowError(error.message));
    return undefined;
  }, [record, refreshStatuses]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    const running = [
      separation,
      ocr,
      speakers,
      finalSubtitles,
      downstreamEnglishDubbing,
      downstreamFinalVideo,
      downstreamFinalValidation,
    ].some((task) => task?.status === "running");
    const interval = window.setInterval(() => {
      void refreshStatuses().catch((error) => setWorkflowError(error.message));
    }, running ? 1500 : 4000);
    window.addEventListener("focus", refreshStatuses);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshStatuses);
    };
  }, [
    record,
    separation?.status,
    ocr?.status,
    speakers?.status,
    finalSubtitles?.status,
    downstreamEnglishDubbing?.status,
    downstreamFinalVideo?.status,
    downstreamFinalValidation?.status,
    refreshStatuses,
  ]);

  const runAutomaticAction = useCallback(async (action) => {
    if (!record || inFlightActions.current.has(action)) {
      return;
    }
    const configuration = {
      separation: ["bs-roformer", setSeparation],
      ocr: ["ocr-subtitles", setOcr],
      speakers: ["whisperx-speakers", setSpeakers],
      finalSubtitles: ["final-subtitles", setFinalSubtitles],
    }[action];
    if (!configuration) {
      return;
    }
    inFlightActions.current.add(action);
    setWorkflowError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/${configuration[0]}/run`, {
        method: "POST",
      });
      configuration[1](status);
    } catch (error) {
      setWorkflowError(error.message);
    } finally {
      inFlightActions.current.delete(action);
    }
  }, [record]);

  useEffect(() => {
    if (!record || !separation || !ocr || !speakers || !finalSubtitles) {
      return;
    }
    const actions = nextAutomaticActions({
      started: workflowStarted,
      storageMode: record.storageMode,
      separation,
      ocr,
      speakers,
      finalSubtitles,
    });
    actions.forEach((action) => void runAutomaticAction(action));
  }, [record, workflowStarted, separation, ocr, speakers, finalSubtitles, runAutomaticAction]);

  useEffect(() => {
    if (!record || !finalSubtitles?.outputs?.srt?.ready) {
      setEditorCues([]);
      setEditorOriginalCues([]);
      return undefined;
    }
    let active = true;
    setEditorError("");
    requestJson(`/api/videos/${record.id}/workflow/chinese-subtitle-editor`)
      .then((result) => {
        if (active) {
          setEditorCues(result.cues || []);
          setEditorOriginalCues(result.cues || []);
        }
      })
      .catch((error) => active && setEditorError(error.message));
    return () => {
      active = false;
    };
  }, [record, finalSubtitles?.outputs?.srt?.ready]);

  const workflowSummary = summarizeAutomaticWorkflow({
    started: workflowStarted,
    separation,
    ocr,
    speakers,
    finalSubtitles,
  });
  const activeCueNumber = editorCues.find(
    (cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs,
  )?.number;

  const retryAutomaticWorkflow = () => {
    setWorkflowStarted(true);
    const failedActions = [
      ["separation", separation],
      ["ocr", ocr],
      ["speakers", speakers],
      ["finalSubtitles", finalSubtitles],
    ].filter(([, task]) => ["failed", "cancelled"].includes(task?.status));
    if (failedActions.length > 0) {
      failedActions.forEach(([action]) => void runAutomaticAction(action));
      return;
    }
    void refreshStatuses().catch((error) => setWorkflowError(error.message));
  };

  const regenerateChineseSubtitles = () => {
    setWorkflowStarted(true);
    void runAutomaticAction("finalSubtitles");
  };

  const updateCueField = (number, field, value) => {
    setEditorCues((current) => current.map(
      (cue) => (cue.number === number ? { ...cue, [field]: value } : cue),
    ));
    setEditorMessage("");
  };

  const applySpeakerToMatchingCues = (number) => {
    const editedCue = editorCues.find((cue) => cue.number === number);
    const sourceCue = editorOriginalCues.find((cue) => cue.number === number);
    if (!editedCue || !sourceCue) {
      return;
    }
    setEditorError("");
    setEditorCues((current) =>
      current.map((cue) => {
        const original = editorOriginalCues.find((savedCue) => savedCue.number === cue.number);
        return original?.speaker === sourceCue.speaker
          ? { ...cue, speaker: editedCue.speaker }
          : cue;
      }),
    );
    setEditorMessage(
      `已将说话人“${sourceCue.speaker || "未标注"}”统一替换为“${editedCue.speaker || "未标注"}”。`,
    );
  };

  const seekToCue = (cue) => {
    if (!videoRef.current) {
      return;
    }
    videoRef.current.currentTime = cue.startMs / 1000;
    setCurrentTimeMs(cue.startMs);
  };

  const saveChineseSubtitles = async () => {
    setIsSaving(true);
    setEditorError("");
    setEditorMessage("");
    try {
      const result = await requestJson(`/api/videos/${record.id}/workflow/chinese-subtitle-editor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cues: editorCues.map(({ number, speaker, text }) => ({ number, speaker, text })),
        }),
      });
      setEditorCues(result.cues || []);
      setEditorOriginalCues(result.cues || []);
      setEditorMessage("中文字幕已保存到最终 SRT。");
    } catch (error) {
      setEditorError(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const replaceProjectSource = async () => {
    setIsReplacingSource(true);
    setSourceReplaceMessage("");
    try {
      const updated = await requestJson(`/api/videos/${record.id}/source/select`, { method: "POST" });
      if (!updated) {
        setSourceReplaceMessage("已取消重新选择原视频。");
        return;
      }
      setRecord(updated);
      setSourceReplaceMessage("原视频路径已更新，自动流程将继续执行。");
    } catch (error) {
      setSourceReplaceMessage(`重新选择原视频失败：${error.message}`);
    } finally {
      setIsReplacingSource(false);
    }
  };

  const openFinalSubtitle = async (artifactKey) => {
    setOpenPathError("");
    try {
      await requestJson(`/api/videos/${record.id}/open-artifact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactKey }),
      });
    } catch (error) {
      setOpenPathError(error.message);
    }
  };

  if (notFound) {
    return <Navigate to="/" replace />;
  }
  if (!record) {
    return <main className="detail-page loading">正在加载视频项目...</main>;
  }

  const sourceDisplayName = record.sourcePath
    ? artifactDisplayName({ path: record.sourcePath })
    : "未记录原视频路径，请重新选择原视频。";
  const displayedError = workflowError || [separation, ocr, speakers, finalSubtitles].find(
    (task) => task?.error,
  )?.error;
  const simplifiedOverview = buildSimplifiedWorkflowOverview({
    started: workflowStarted,
    storageMode: record.storageMode,
    separation,
    ocr,
    speakers,
    finalSubtitles,
    subtitleEditorComplete: translationStatus?.complete,
    englishDubbing: downstreamEnglishDubbing,
    finalVideo: downstreamFinalVideo,
    finalValidation: downstreamFinalValidation,
  });
  const selectedOverviewStep = simplifiedOverview.steps.find((step) => step.id === selectedPanel);
  const canStartChineseWorkflow =
    record.storageMode === "reference" &&
    Boolean(separation) &&
    Boolean(ocr) &&
    finalSubtitles?.status !== "running";
  const simplifiedNextDisabled =
    simplifiedOverview.nextAction?.id === "generateChinese" &&
    !canStartChineseWorkflow;
  const runSimplifiedOverviewNext = () => {
    const actionId = simplifiedOverview.nextAction?.id;
    if (!actionId) {
      return;
    }
    setSelectedPanel(actionId);
    if (actionId === "generateChinese" && finalSubtitles?.status !== "completed") {
      setWorkflowStarted(true);
    }
  };
  const selectPanel = (panelId) => {
    setStageDeleteMessage("");
    setSelectedPanel(panelId);
  };
  const resetWorkflowArtifactsState = () => {
    setEditorCues([]);
    setEditorOriginalCues([]);
    setWorkflowStarted(false);
    setEmbeddedPanelVersion((version) => version + 1);
  };
  const deleteSelectedStageArtifacts = async () => {
    const stageId = selectedOverviewStep?.id;
    const stageTitle = selectedOverviewStep?.title || "当前步骤";
    if (!stageId || !window.confirm(
      `删除“${stageTitle}”当前步骤及其后续步骤的产物？\n\n原视频不会被删除。`,
    )) {
      return;
    }
    setDeletingStage(stageId);
    setStageDeleteMessage("");
    setWorkflowError("");
    try {
      const result = await requestJson(
        `/api/videos/${record.id}/workflow/stages/${stageId}`,
        { method: "DELETE" },
      );
      const resetsChineseWorkflow = ["generateChinese", "reviewChinese"].includes(stageId);
      if (resetsChineseWorkflow) {
        setEditorCues([]);
        setEditorOriginalCues([]);
        setWorkflowStarted(false);
      }
      await refreshStatuses();
      if (resetsChineseWorkflow) {
        setWorkflowStarted(false);
      }
      setEmbeddedPanelVersion((version) => version + 1);
      setStageDeleteMessage(
        result.deletedCount > 0
          ? `已删除“${stageTitle}”及后续步骤产物。`
          : `“${stageTitle}”没有可删除的产物。`,
      );
    } catch (error) {
      setWorkflowError(`删除步骤产物失败：${error.message}`);
    } finally {
      setDeletingStage("");
    }
  };
  const deleteAllArtifacts = async () => {
    if (!window.confirm("删除当前项目的全部产物？\n\n原视频不会被删除。")) {
      return;
    }
    setDeletingStage("all");
    setStageDeleteMessage("");
    setWorkflowError("");
    try {
      const result = await requestJson(
        `/api/videos/${record.id}/workflow/stages/all`,
        { method: "DELETE" },
      );
      resetWorkflowArtifactsState();
      await refreshStatuses();
      setWorkflowStarted(false);
      setStageDeleteMessage(
        result.deletedCount > 0
          ? "已删除当前项目全部产物。"
          : "当前项目没有可删除的产物。",
      );
    } catch (error) {
      setWorkflowError(`删除全部产物失败：${error.message}`);
    } finally {
      setDeletingStage("");
    }
  };
  const workflowRunning = [
    separation,
    ocr,
    speakers,
    finalSubtitles,
    downstreamEnglishDubbing,
    downstreamFinalVideo,
    downstreamFinalValidation,
  ].some((task) => task?.status === "running");

  return (
    <main className="detail-page simplified-detail-page">
      <header className="detail-header simplified-detail-header">
        <div>
          <p className="eyebrow">中文字幕项目</p>
          <h1>{record.name}</h1>
          <p className="file-meta">{formatSize(record.size)} · 自动生成最终中文字幕</p>
          <p className={`project-path ${record.sourcePath ? "" : "warning"}`} title={record.sourcePath || sourceDisplayName}>
            原视频：{sourceDisplayName}
          </p>
        </div>
      </header>
      {sourceReplaceMessage && <p className="copy-status">{sourceReplaceMessage}</p>}

      <ProjectWorkflowOverview
        overview={simplifiedOverview}
        nextDisabled={simplifiedNextDisabled}
        onRunNext={runSimplifiedOverviewNext}
        onStepSelect={selectPanel}
        selectedStepId={selectedPanel}
      />
      <div className="stage-artifact-toolbar">
        <span>{stageDeleteMessage}</span>
        <button
          className="danger-button compact"
          disabled={Boolean(deletingStage) || workflowRunning}
          type="button"
          onClick={deleteSelectedStageArtifacts}
        >
          {deletingStage && deletingStage !== "all" ? "正在删除..." : "删除当前步骤产物"}
        </button>
        <button
          className="danger-button compact ghost"
          disabled={Boolean(deletingStage) || workflowRunning}
          type="button"
          onClick={deleteAllArtifacts}
        >
          {deletingStage === "all" ? "正在删除..." : "删除全部产物"}
        </button>
      </div>

      {selectedPanel === "generateChinese" && (
        <section className={`generation-panel ${workflowSummary.state}`} aria-label="生成中文字幕阶段详情">
          <div className="generation-panel-main">
            <div className="generation-source">
              <p className="eyebrow">输入视频</p>
              <h2>{record.name}</h2>
              <p className={`project-path ${record.sourcePath ? "" : "warning"}`} title={record.sourcePath || sourceDisplayName}>
                {sourceDisplayName}
              </p>
            </div>
            <div className="generation-status">
              <p className="eyebrow">字幕文件</p>
              <h3>{workflowSummary.title}</h3>
              <p>{workflowSummary.detail}</p>
              <div className="automatic-progress" aria-label={`自动流程完成 ${workflowSummary.percent}%`}>
                <span style={{ width: `${workflowSummary.percent}%` }} />
              </div>
            </div>
          </div>

          {finalSubtitles?.outputs?.srt?.ready && (
            <FileResult
              artifactKey="finalSubtitles.srt"
              label="最终字幕"
              file={finalSubtitles.outputs.srt}
              onOpen={openFinalSubtitle}
              readyText="已生成"
            />
          )}
          {displayedError && <p className="workflow-error page-error">{displayedError}</p>}
          {openPathError && <p className="workflow-error page-error">{openPathError}</p>}

          <div className="generation-actions">
            <button className="secondary-button compact" disabled={isReplacingSource} type="button" onClick={replaceProjectSource}>
              {isReplacingSource ? "等待选择..." : "更换原视频"}
            </button>
            {!workflowStarted && finalSubtitles?.status !== "completed" && (
              <button
                className="primary-button compact"
                disabled={!canStartChineseWorkflow}
                type="button"
                onClick={() => setWorkflowStarted(true)}
              >
                开始生成中文字幕
              </button>
            )}
            {finalSubtitles?.outputs?.srt?.ready && (
              <button
                className="primary-button compact"
                disabled={!finalSubtitles?.canRun || finalSubtitles?.status === "running"}
                type="button"
                onClick={regenerateChineseSubtitles}
              >
                {finalSubtitles?.status === "running" ? "正在重新生成..." : "重新生成字幕文件"}
              </button>
            )}
            {(workflowSummary.state === "failed" || displayedError) && (
              <button className="secondary-button compact" type="button" onClick={retryAutomaticWorkflow}>重试自动流程</button>
            )}
          </div>
        </section>
      )}

      {selectedPanel === "reviewChinese" && (
        <section className="selected-workflow-panel" aria-label="校正中文字幕阶段详情">
          <header className="selected-panel-heading">
            <p className="eyebrow">当前阶段</p>
            <h2>{selectedOverviewStep?.title || "校正中文字幕"}</h2>
            <p>播放原视频，点击时间码跳转到画面位置，在本页面更正最终中文字幕文本。</p>
          </header>
          {openPathError && <p className="workflow-error page-error">{openPathError}</p>}
          {!finalSubtitles?.outputs?.srt?.ready && (
            <p className="copy-status">等待新步骤 1 生成最终中文字幕 SRT 后，可以在这里边播放边校正字幕。</p>
          )}
          {finalSubtitles?.outputs?.srt?.ready && (
            <section className="subtitle-workbench" aria-label="最终中文字幕工作台">
              <div className="video-review-panel">
                <video
                  ref={videoRef}
                  className="review-video"
                  controls
                  preload="metadata"
                  src={`/api/videos/${record.id}/content`}
                  onTimeUpdate={(event) => setCurrentTimeMs(event.currentTarget.currentTime * 1000)}
                >
                  当前环境不支持视频播放。
                </video>
                <FileResult
                  artifactKey="finalSubtitles.srt"
                  label="最终成果"
                  file={finalSubtitles.outputs.srt}
                  onOpen={openFinalSubtitle}
                  readyText="已生成"
                />
              </div>

              <section className="chinese-subtitle-editor" aria-label="最终中文字幕编辑器">
                <div className="chinese-editor-heading">
                  <div>
                    <p className="eyebrow">边看边改</p>
                    <h2>更正最终中文字幕</h2>
                    <p>点击时间码可跳到对应画面，时间轴保持只读。</p>
                  </div>
                  <button className="primary-button" disabled={isSaving || editorCues.length === 0} type="button" onClick={saveChineseSubtitles}>
                    {isSaving ? "正在保存..." : "保存中文字幕"}
                  </button>
                </div>
                {editorError && <p className="workflow-error">{editorError}</p>}
                {editorMessage && <p className="copy-status">{editorMessage}</p>}
                {editorCues.length === 0 && !editorError && <p className="copy-status">正在读取最终中文字幕...</p>}
                <div className="chinese-cue-list">
                  {editorCues.map((cue) => (
                    <article className={`chinese-cue-row ${activeCueNumber === cue.number ? "active" : ""}`} key={cue.number}>
                      <button className="cue-time-button" type="button" onClick={() => seekToCue(cue)}>
                        <strong>{String(cue.number).padStart(3, "0")}</strong>
                        <span>{cue.start} - {cue.end}</span>
                      </button>
                      <div className="cue-speaker-field">
                        <span>Speaker</span>
                        <input
                          aria-label={`第 ${cue.number} 条说话人`}
                          maxLength={200}
                          placeholder="未标注"
                          type="text"
                          value={cue.speaker || ""}
                          onChange={(event) => updateCueField(cue.number, "speaker", event.target.value)}
                        />
                        <button
                          className="role-apply-button"
                          type="button"
                          onClick={() => applySpeakerToMatchingCues(cue.number)}
                        >
                          应用到同角色
                        </button>
                      </div>
                      <textarea
                        aria-label={`第 ${cue.number} 条中文字幕`}
                        rows={2}
                        value={cue.text}
                        onChange={(event) => updateCueField(cue.number, "text", event.target.value)}
                      />
                    </article>
                  ))}
                </div>
              </section>
            </section>
          )}
        </section>
      )}

      {selectedPanel && !["generateChinese", "reviewChinese"].includes(selectedPanel) && (
        <VideoPage
          key={`${selectedPanel}-${embeddedPanelVersion}`}
          videos={videos}
          isLoading={isLoading}
          embedded
          visiblePanel={selectedPanel}
        />
      )}
    </main>
  );
}

function VideoPage({ videos, isLoading, embedded = false, visiblePanel = null }) {
  const { videoId } = useParams();
  const finalValidationVideoRef = useRef(null);
  const validationResumeTimeRef = useRef(null);
  const [record, setRecord] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [isReplacingSource, setIsReplacingSource] = useState(false);
  const [sourceReplaceMessage, setSourceReplaceMessage] = useState("");
  const [cancellingWorkflow, setCancellingWorkflow] = useState("");
  const [separation, setSeparation] = useState(null);
  const [separationError, setSeparationError] = useState("");
  const [isStartingSeparation, setIsStartingSeparation] = useState(false);
  const [ocr, setOcr] = useState(null);
  const [ocrError, setOcrError] = useState("");
  const [isStartingOcr, setIsStartingOcr] = useState(false);
  const [speakers, setSpeakers] = useState(null);
  const [speakersError, setSpeakersError] = useState("");
  const [isStartingSpeakers, setIsStartingSpeakers] = useState(false);
  const [finalSubtitles, setFinalSubtitles] = useState(null);
  const [finalSubtitlesError, setFinalSubtitlesError] = useState("");
  const [isStartingFinalSubtitles, setIsStartingFinalSubtitles] = useState(false);
  const [subtitleEditor, setSubtitleEditor] = useState(null);
  const [subtitleEditorCues, setSubtitleEditorCues] = useState([]);
  const [subtitleEditorError, setSubtitleEditorError] = useState("");
  const [subtitleEditorMessage, setSubtitleEditorMessage] = useState("");
  const [translationPromptVisible, setTranslationPromptVisible] = useState(false);
  const [translationPromptText, setTranslationPromptText] = useState("");
  const [isImportingTranslationSrt, setIsImportingTranslationSrt] = useState(false);
  const [isSavingSubtitleEditor, setIsSavingSubtitleEditor] = useState(false);
  const [englishDubbing, setEnglishDubbing] = useState(null);
  const [englishDubbingError, setEnglishDubbingError] = useState("");
  const [isStartingEnglishDubbing, setIsStartingEnglishDubbing] = useState(false);
  const [selectedDubbingSegmentNumber, setSelectedDubbingSegmentNumber] = useState(null);
  const [dubbingSegmentDraft, setDubbingSegmentDraft] = useState(null);
  const [dubbingSegmentMessage, setDubbingSegmentMessage] = useState("");
  const [isRegeneratingDubbingSegment, setIsRegeneratingDubbingSegment] = useState(false);
  const [finalVideo, setFinalVideo] = useState(null);
  const [finalVideoStyle, setFinalVideoStyle] = useState(defaultFinalVideoStyle);
  const [finalVideoError, setFinalVideoError] = useState("");
  const [isGeneratingFinalVideoPreview, setIsGeneratingFinalVideoPreview] = useState(false);
  const [isStartingFinalVideo, setIsStartingFinalVideo] = useState(false);
  const [finalValidation, setFinalValidation] = useState(null);
  const [finalValidationError, setFinalValidationError] = useState("");
  const [isStartingFinalValidation, setIsStartingFinalValidation] = useState(false);
  const [validationCurrentTime, setValidationCurrentTime] = useState(0);
  const [validationRangeStart, setValidationRangeStart] = useState("");
  const [validationRangeEnd, setValidationRangeEnd] = useState("");
  const [sourceAudioRanges, setSourceAudioRanges] = useState([]);
  const [mutedBackgroundRanges, setMutedBackgroundRanges] = useState([]);
  const [validationDirty, setValidationDirty] = useState(false);
  const [validationVideoVersion, setValidationVideoVersion] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [openPathError, setOpenPathError] = useState("");

  const refreshFinalSubtitlesStatus = useCallback(async () => {
    if (!record) {
      return null;
    }
    try {
      const result = await requestJson(`/api/videos/${record.id}/workflow/final-subtitles`);
      setFinalSubtitles(result);
      setFinalSubtitlesError("");
      return result;
    } catch (error) {
      setFinalSubtitlesError(error.message);
      return null;
    }
  }, [record]);

  useEffect(() => {
    let isActive = true;
    const cached = videos.find((video) => video.id === videoId);
    if (cached) {
      setRecord(cached);
      setNotFound(false);
      return undefined;
    }
    if (!isLoading) {
      requestJson(`/api/videos/${videoId}`)
        .then((video) => {
          if (isActive) {
            setRecord(video);
          }
        })
        .catch(() => {
          if (isActive) {
            setNotFound(true);
          }
        });
    }
    return () => {
      isActive = false;
    };
  }, [isLoading, videoId, videos]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    let active = true;
    setSeparation(null);
    setOcr(null);
    setSpeakers(null);
    setFinalSubtitles(null);
    setEnglishDubbing(null);
    setFinalVideo(null);
    setFinalValidation(null);
    setFinalVideoStyle(defaultFinalVideoStyle);
    setSeparationError("");
    setSourceReplaceMessage("");
    setCancellingWorkflow("");
    setOcrError("");
    setSpeakersError("");
    setFinalSubtitlesError("");
    setSubtitleEditor(null);
    setSubtitleEditorCues([]);
    setSubtitleEditorError("");
    setSubtitleEditorMessage("");
    setTranslationPromptVisible(false);
    setTranslationPromptText("");
    setIsImportingTranslationSrt(false);
    setEnglishDubbingError("");
    setSelectedDubbingSegmentNumber(null);
    setDubbingSegmentDraft(null);
    setDubbingSegmentMessage("");
    setIsRegeneratingDubbingSegment(false);
    setFinalVideoError("");
    setFinalValidationError("");
    setValidationCurrentTime(0);
    setValidationRangeStart("");
    setValidationRangeEnd("");
    setSourceAudioRanges([]);
    setMutedBackgroundRanges([]);
    setValidationDirty(false);
    setOpenPathError("");
    requestJson(`/api/videos/${record.id}/workflow/bs-roformer`)
      .then((result) => {
        if (active) {
          setSeparation(result);
        }
      })
      .catch((error) => {
        if (active) {
          setSeparationError(error.message);
        }
      });
    requestJson(`/api/videos/${record.id}/workflow/ocr-subtitles`)
      .then((result) => {
        if (active) {
          setOcr(result);
        }
      })
      .catch((error) => {
        if (active) {
          setOcrError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [record]);

  useEffect(() => {
    if (!record || separation?.status !== "running") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      requestJson(`/api/videos/${record.id}/workflow/bs-roformer`)
        .then((result) => setSeparation(result))
        .catch((error) => setSeparationError(error.message));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [record, separation?.status]);

  useEffect(() => {
    if (!record || ocr?.status !== "running") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      requestJson(`/api/videos/${record.id}/workflow/ocr-subtitles`)
        .then((result) => setOcr(result))
        .catch((error) => setOcrError(error.message));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [record, ocr?.status]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    let active = true;
    requestJson(`/api/videos/${record.id}/workflow/whisperx-speakers`)
      .then((result) => {
        if (active) {
          setSpeakers(result);
        }
      })
      .catch((error) => {
        if (active) {
          setSpeakersError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [record, separation?.outputs?.dialogue?.ready]);

  useEffect(() => {
    if (!record || speakers?.status !== "running") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      requestJson(`/api/videos/${record.id}/workflow/whisperx-speakers`)
        .then((result) => setSpeakers(result))
        .catch((error) => setSpeakersError(error.message));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [record, speakers?.status]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    void refreshFinalSubtitlesStatus().catch(() => { });
    return undefined;
  }, [
    record,
    ocr?.outputs?.srt?.ready,
    speakers?.outputs?.srt?.ready,
    refreshFinalSubtitlesStatus,
  ]);

  useEffect(() => {
    if (
      !record ||
      (finalSubtitles?.status !== "running" && !finalSubtitles?.outputs?.srt?.ready)
    ) {
      return undefined;
    }
    const refreshDelay = finalSubtitles?.status === "running" ? 1500 : 4000;
    const interval = window.setInterval(() => {
      void refreshFinalSubtitlesStatus().catch(() => { });
    }, refreshDelay);
    window.addEventListener("focus", refreshFinalSubtitlesStatus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshFinalSubtitlesStatus);
    };
  }, [
    record,
    finalSubtitles?.status,
    finalSubtitles?.outputs?.srt?.ready,
    refreshFinalSubtitlesStatus,
  ]);

  useEffect(() => {
    if (!record || !finalSubtitles?.outputs?.srt?.ready) {
      setSubtitleEditor(null);
      setSubtitleEditorCues([]);
      return undefined;
    }
    let active = true;
    setSubtitleEditorError("");
    requestJson(`/api/videos/${record.id}/workflow/subtitle-editor`)
      .then((result) => {
        if (active) {
          setSubtitleEditor(result);
          setSubtitleEditorCues(result.cues || []);
          setTranslationPromptText(
            buildTranslationPrompt(
              finalSubtitles.outputs.srt.path,
              finalSubtitles.translationTarget.jsonPath,
            ),
          );
        }
      })
      .catch((error) => {
        if (active) {
          setSubtitleEditorError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [record, finalSubtitles?.outputs?.srt?.ready]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    let active = true;
    const readStatus = () => {
      requestJson(`/api/videos/${record.id}/workflow/english-dubbing-mix`)
        .then((result) => {
          if (active) {
            setEnglishDubbing(result);
          }
        })
        .catch((error) => {
          if (active) {
            setEnglishDubbingError(error.message);
          }
        });
    };
    readStatus();
    const interval = window.setInterval(
      readStatus,
      englishDubbing?.status === "running" ? 1500 : 4000,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [record, englishDubbing?.status]);

  useEffect(() => {
    const segments = englishDubbing?.segments || [];
    if (segments.length === 0) {
      setSelectedDubbingSegmentNumber(null);
      setDubbingSegmentDraft(null);
      return;
    }
    const selected =
      segments.find((segment) => segment.number === selectedDubbingSegmentNumber) || segments[0];
    if (selected.number !== selectedDubbingSegmentNumber) {
      setSelectedDubbingSegmentNumber(selected.number);
    }
    setDubbingSegmentDraft((draft) =>
      draft?.number === selected.number ? draft : dubbingSegmentDraftFrom(selected),
    );
  }, [englishDubbing?.segments, selectedDubbingSegmentNumber]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    let active = true;
    requestJson(`/api/videos/${record.id}/workflow/final-video`)
      .then((result) => {
        if (active) {
          setFinalVideo(result);
          setFinalVideoStyle(result.style || defaultFinalVideoStyle);
        }
      })
      .catch((error) => {
        if (active) {
          setFinalVideoError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [
    record,
    englishDubbing?.status,
    englishDubbing?.preflightOutdated,
    englishDubbing?.mixOutdated,
    englishDubbing?.outputs?.mixedTrack?.ready,
  ]);

  useEffect(() => {
    if (!record || finalVideo?.status !== "running") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      requestJson(`/api/videos/${record.id}/workflow/final-video`)
        .then((result) => setFinalVideo(result))
        .catch((error) => setFinalVideoError(error.message));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [record, finalVideo?.status]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    let active = true;
    const readStatus = () => {
      requestJson(`/api/videos/${record.id}/workflow/final-validation`)
        .then((result) => {
          if (!active) {
            return;
          }
          setFinalValidation(result);
          setSourceAudioRanges(result.configuration?.sourceAudioRanges || []);
          setMutedBackgroundRanges(result.configuration?.mutedBackgroundRanges || []);
          if (result.status === "completed" && finalValidation?.status === "running") {
            setValidationVideoVersion(Date.now());
          }
          setFinalValidationError("");
        })
        .catch((error) => {
          if (active) {
            setFinalValidationError(error.message);
          }
        });
    };
    readStatus();
    const interval = finalValidation?.status === "running"
      ? window.setInterval(readStatus, 1500)
      : null;
    return () => {
      active = false;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [record, finalVideo?.status, finalValidation?.status]);

  const runSeparation = async () => {
    setIsStartingSeparation(true);
    setSeparationError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/bs-roformer/run`, {
        method: "POST",
      });
      setSeparation(status);
    } catch (error) {
      setSeparationError(error.message);
    } finally {
      setIsStartingSeparation(false);
    }
  };

  const runOcr = async () => {
    setIsStartingOcr(true);
    setOcrError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/ocr-subtitles/run`, {
        method: "POST",
      });
      setOcr(status);
    } catch (error) {
      setOcrError(error.message);
    } finally {
      setIsStartingOcr(false);
    }
  };

  const runSpeakers = async () => {
    setIsStartingSpeakers(true);
    setSpeakersError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/whisperx-speakers/run`, {
        method: "POST",
      });
      setSpeakers(status);
    } catch (error) {
      setSpeakersError(error.message);
    } finally {
      setIsStartingSpeakers(false);
    }
  };

  const runFinalSubtitles = async () => {
    setIsStartingFinalSubtitles(true);
    setFinalSubtitlesError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/final-subtitles/run`, {
        method: "POST",
      });
      setFinalSubtitles(status);
    } catch (error) {
      setFinalSubtitlesError(error.message);
    } finally {
      setIsStartingFinalSubtitles(false);
    }
  };

  const canTranslate = finalSubtitles?.outputs?.srt?.ready;
  const subtitleEditorComplete =
    subtitleEditorCues.length > 0 &&
    subtitleEditorCues.every((cue) => cue.english.trim() || cue.skipped);
  const pendingEnglishNumbers = subtitleEditorCues
    .filter((cue) => !cue.english.trim() && !cue.skipped)
    .map((cue) => String(cue.number).padStart(3, "0"));
  const translationPrompt =
    translationPromptText ||
    buildTranslationPrompt(
      finalSubtitles?.outputs?.srt?.path,
      finalSubtitles?.translationTarget?.jsonPath,
    );
  const updateSubtitleCue = (number, field, value) => {
    setSubtitleEditorMessage("");
    setSubtitleEditorError("");
    setSubtitleEditorCues((cues) =>
      cues.map((cue) => {
        if (cue.number !== number) {
          return cue;
        }
        if (field === "english") {
          const english = value;
          return {
            ...cue,
            english,
            skipped: !english.trim(),
          };
        }
        return { ...cue, [field]: value };
      }),
    );
  };

  const applyRoleToMatchingCues = (number) => {
    const editedCue = subtitleEditorCues.find((cue) => cue.number === number);
    const sourceCue = subtitleEditor?.cues?.find((cue) => cue.number === number);
    if (!editedCue || !sourceCue) {
      return;
    }
    setSubtitleEditorError("");
    setSubtitleEditorCues((cues) =>
      cues.map((cue) => {
        const original = subtitleEditor.cues.find((savedCue) => savedCue.number === cue.number);
        return original?.role === sourceCue.role ? { ...cue, role: editedCue.role } : cue;
      }),
    );
    setSubtitleEditorMessage(`已将角色“${sourceCue.role || "未标注"}”统一替换为“${editedCue.role || "未标注"}”。`);
  };

  const copyTranslationPrompt = async () => {
    try {
      await navigator.clipboard.writeText(translationPrompt);
      setSubtitleEditorMessage("当前 Gemini 提示词已复制。复制内容为编辑后的版本。");
    } catch {
      setSubtitleEditorError("复制提示词失败，请在展开的提示词框中手动复制。");
    }
  };

  const importTranslationSrt = async () => {
    setIsImportingTranslationSrt(true);
    setSubtitleEditorError("");
    setSubtitleEditorMessage("");
    try {
      await refreshFinalSubtitlesStatus();
      const result = await requestJson(`/api/videos/${record.id}/workflow/subtitle-editor/import-srt`, {
        method: "POST",
      });
      setSubtitleEditor(result);
      setSubtitleEditorCues(result.cues);
      setSubtitleEditorMessage(
        `已解析英文字幕文件：导入 ${result.completedEnglishCount} 条，跳过 ${result.skippedEnglishCount} 条。请校对后保存。`,
      );
      setFinalSubtitles(await requestJson(`/api/videos/${record.id}/workflow/final-subtitles`));
      setEnglishDubbing(await requestJson(`/api/videos/${record.id}/workflow/english-dubbing-mix`));
      setFinalVideo(await requestJson(`/api/videos/${record.id}/workflow/final-video`));
    } catch (error) {
      setSubtitleEditorError(error.message);
    } finally {
      setIsImportingTranslationSrt(false);
    }
  };

  const saveSubtitleEdits = async () => {
    setIsSavingSubtitleEditor(true);
    setSubtitleEditorError("");
    setSubtitleEditorMessage("");
    try {
      const result = await requestJson(`/api/videos/${record.id}/workflow/subtitle-editor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cues: subtitleEditorCues.map(({ number, role, english, skipped }) => ({
            number,
            role,
            english,
            skipped,
          })),
        }),
      });
      setSubtitleEditor(result);
      setSubtitleEditorCues(result.cues);
      const remainingEnglishCount = result.cues.filter((cue) => !cue.english.trim() && !cue.skipped).length;
      setSubtitleEditorMessage(
        result.complete
          ? "角色与英文字幕已保存。配音阶段将基于这些内容生成受控英文字幕。"
          : remainingEnglishCount > 0
            ? `编辑进度已保存，仍有 ${remainingEnglishCount} 条英文待填写。`
            : "编辑进度已保存，留空条目已视为跳过。",
      );
      setFinalSubtitles(await requestJson(`/api/videos/${record.id}/workflow/final-subtitles`));
      setEnglishDubbing(await requestJson(`/api/videos/${record.id}/workflow/english-dubbing-mix`));
      setFinalVideo(await requestJson(`/api/videos/${record.id}/workflow/final-video`));
    } catch (error) {
      setSubtitleEditorError(error.message);
    } finally {
      setIsSavingSubtitleEditor(false);
    }
  };

  const runEnglishDubbing = async () => {
    setIsStartingEnglishDubbing(true);
    setEnglishDubbingError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/english-dubbing-mix/run`, {
        method: "POST",
      });
      setEnglishDubbing(status);
    } catch (error) {
      setEnglishDubbingError(error.message);
    } finally {
      setIsStartingEnglishDubbing(false);
    }
  };

  const regenerateDubbingSegment = async () => {
    if (!selectedDubbingSegmentNumber || !dubbingSegmentDraft) {
      return;
    }
    setIsRegeneratingDubbingSegment(true);
    setEnglishDubbingError("");
    setDubbingSegmentMessage("");
    try {
      const status = await requestJson(
        `/api/videos/${record.id}/workflow/english-dubbing-mix/segments/${selectedDubbingSegmentNumber}/regenerate`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speaker: dubbingSegmentDraft.speaker,
            referenceAudioPath: dubbingSegmentDraft.referenceAudioPath,
            text: dubbingSegmentDraft.text,
          }),
        },
      );
      setEnglishDubbing(status);
      setDubbingSegmentMessage(
        `第 ${String(selectedDubbingSegmentNumber).padStart(3, "0")} 条已提交重新配音，完成后会自动刷新整轨混音。`,
      );
    } catch (error) {
      setEnglishDubbingError(error.message);
    } finally {
      setIsRegeneratingDubbingSegment(false);
    }
  };

  const chooseDubbingReferenceAudio = async () => {
    if (!selectedDubbingSegmentNumber || !dubbingSegmentDraft) {
      return;
    }
    setEnglishDubbingError("");
    setDubbingSegmentMessage("");
    try {
      const selected = await requestJson(
        `/api/videos/${record.id}/workflow/english-dubbing-mix/reference-audio/select`,
        { method: "POST" },
      );
      if (!selected?.path) {
        return;
      }
      setDubbingSegmentDraft((draft) => draft && {
        ...draft,
        referenceAudioPath: selected.path,
        referenceAudioName: selected.name || pathLeafName(selected.path),
      });
      setDubbingSegmentMessage(
        `已选择参考音频：${selected.name || pathLeafName(selected.path)}。点击重新配音后生效。`,
      );
    } catch (error) {
      setEnglishDubbingError(`选择参考音频失败：${error.message}`);
    }
  };

  const cancelWorkflow = async (workflow, statusPath, setStatus, setError) => {
    setCancellingWorkflow(workflow);
    setError("");
    try {
      await requestJson(`/api/videos/${record.id}/jobs/${workflow}/cancel`, {
        method: "POST",
      });
      setStatus(await requestJson(`/api/videos/${record.id}/workflow/${statusPath}`));
    } catch (error) {
      setError(`取消任务失败：${error.message}`);
    } finally {
      setCancellingWorkflow("");
    }
  };

  const persistFinalVideoStyle = useCallback((style) => {
    if (!record) {
      return;
    }
    void requestJson(`/api/videos/${record.id}/workflow/final-video/style`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style }),
    }).catch((error) => setFinalVideoError(`保存字幕样式失败：${error.message}`));
  }, [record]);

  const updateFinalVideoStyle = (field, value) => {
    setFinalVideoStyle((style) => {
      const nextStyle = {
      ...style,
      [field]:
        field === "fontSize"
          ? clampSubtitleFontSize(value)
          : field === "positionX" || field === "positionY"
            ? clampSubtitlePosition(value)
            : value,
      };
      persistFinalVideoStyle(nextStyle);
      return nextStyle;
    });
  };
  const updateFinalVideoStyleValues = useCallback((values) => {
    setFinalVideoStyle((style) => {
      const nextStyle = {
        ...style,
        ...values,
      };
      persistFinalVideoStyle(nextStyle);
      return nextStyle;
    });
  }, [persistFinalVideoStyle]);

  const generateFinalVideoPreview = async () => {
    setIsGeneratingFinalVideoPreview(true);
    setFinalVideoError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/final-video/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: finalVideoStyle }),
      });
      setFinalVideo(status);
      setPreviewVersion(Date.now());
    } catch (error) {
      setFinalVideoError(error.message);
    } finally {
      setIsGeneratingFinalVideoPreview(false);
    }
  };

  const runFinalVideo = async () => {
    setIsStartingFinalVideo(true);
    setFinalVideoError("");
    try {
      const status = await requestJson(`/api/videos/${record.id}/workflow/final-video/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: finalVideoStyle }),
      });
      setFinalVideo(status);
    } catch (error) {
      setFinalVideoError(error.message);
    } finally {
      setIsStartingFinalVideo(false);
    }
  };

  const setValidationBoundary = (field) => {
    const current = Number(finalValidationVideoRef.current?.currentTime || 0);
    const value = current.toFixed(3);
    setValidationCurrentTime(current);
    if (field === "start") {
      setValidationRangeStart(value);
    } else {
      setValidationRangeEnd(value);
    }
  };

  const addValidationRange = (setRanges) => {
    const start = Number(validationRangeStart);
    const end = Number(validationRangeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      setFinalValidationError("请输入有效时间段，结束时间必须晚于开始时间。");
      return;
    }
    setRanges((ranges) => mergeTimelineRanges([...ranges, { start, end }]));
    setFinalValidationError("");
    setValidationRangeStart("");
    setValidationRangeEnd("");
    setValidationDirty(true);
  };

  const removeValidationRange = (setRanges, index) => {
    setRanges((ranges) => ranges.filter((_, rangeIndex) => rangeIndex !== index));
    setValidationDirty(true);
  };

  const runFinalValidation = async () => {
    validationResumeTimeRef.current = Number(
      finalValidationVideoRef.current?.currentTime || validationCurrentTime || 0,
    );
    setIsStartingFinalValidation(true);
    setFinalValidationError("");
    try {
      const status = await requestJson(
        `/api/videos/${record.id}/workflow/final-validation/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceAudioRanges,
            mutedBackgroundRanges,
          }),
        },
      );
      setFinalValidation(status);
      setValidationDirty(false);
    } catch (error) {
      setFinalValidationError(error.message);
    } finally {
      setIsStartingFinalValidation(false);
    }
  };

  const restoreFinalValidationPlaybackTime = (event) => {
    const resumeTime = validationResumeTimeRef.current;
    if (!Number.isFinite(resumeTime) || resumeTime <= 0) {
      return;
    }
    const duration = Number(event.currentTarget.duration);
    const nextTime = Number.isFinite(duration)
      ? Math.min(resumeTime, Math.max(0, duration - 0.05))
      : resumeTime;
    event.currentTarget.currentTime = nextTime;
    setValidationCurrentTime(nextTime);
    validationResumeTimeRef.current = null;
  };

  const replaceProjectSource = async () => {
    setIsReplacingSource(true);
    setSourceReplaceMessage("");
    try {
      const updated = await requestJson(`/api/videos/${record.id}/source/select`, {
        method: "POST",
      });
      if (!updated) {
        setSourceReplaceMessage("已取消重新选择原视频。");
        return;
      }
      setRecord(updated);
      setSourceReplaceMessage("原视频路径已更新，可以重新执行失败步骤。");
    } catch (error) {
      setSourceReplaceMessage(`重新选择原视频失败：${error.message}`);
    } finally {
      setIsReplacingSource(false);
    }
  };

  const openPath = async (artifactKey) => {
    setOpenPathError("");
    try {
      await requestJson(`/api/videos/${record.id}/open-artifact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactKey }),
      });
    } catch (error) {
      setOpenPathError(error.message);
    }
  };

  if (notFound) {
    return <Navigate to="/" replace />;
  }
  if (!record) {
    return embedded
      ? <section className="embedded-production-flow loading">正在加载完整制作流程...</section>
      : <main className="detail-page loading">正在加载视频项目...</main>;
  }
  const sourceDisplayName = record.sourcePath
    ? artifactDisplayName({ path: record.sourcePath })
    : "未记录原视频路径，请重新添加原视频以执行工作流。";
  const sourceUnavailable = separation?.sourceReady === false || ocr?.sourceReady === false;
  const sourceActionDisabled = record.storageMode !== "reference" || sourceUnavailable;
  const workflowOverview = buildWorkflowOverview({
    storageMode: record.storageMode,
    separation,
    ocr,
    speakers,
    finalSubtitles,
    canTranslate,
    subtitleEditorComplete,
    englishDubbing,
    finalVideo,
  });
  const dubbingSegments = englishDubbing?.segments || [];
  const selectedDubbingSegment =
    dubbingSegments.find((segment) => segment.number === selectedDubbingSegmentNumber) ||
    dubbingSegments[0] ||
    null;
  const scrollToWorkflowStep = (stepId) => {
    document.getElementById(`workflow-step-${stepId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const overviewActionDisabledById = {
    separation:
      isStartingSeparation ||
      separation?.status === "running" ||
      sourceActionDisabled,
    ocr: isStartingOcr || ocr?.status === "running" || sourceActionDisabled,
    speakers:
      isStartingSpeakers ||
      speakers?.status === "running" ||
      !speakers?.canRun ||
      record.storageMode !== "reference",
    finalSubtitles:
      isStartingFinalSubtitles ||
      finalSubtitles?.status === "running" ||
      !finalSubtitles?.canRun ||
      record.storageMode !== "reference",
    translation: !canTranslate,
    englishDubbing:
      isStartingEnglishDubbing ||
      englishDubbing?.status === "running" ||
      !englishDubbing?.canRun ||
      record.storageMode !== "reference",
    finalVideo:
      isStartingFinalVideo ||
      finalVideo?.status === "running" ||
      !finalVideo?.canRun ||
      record.storageMode !== "reference",
  };
  const runOverviewNext = () => {
    const actionId = workflowOverview.nextAction?.id;
    if (!actionId) {
      return;
    }
    if (actionId === "translation") {
      scrollToWorkflowStep(actionId);
      return;
    }
    const handlers = {
      separation: runSeparation,
      ocr: runOcr,
      speakers: runSpeakers,
      finalSubtitles: runFinalSubtitles,
      englishDubbing: runEnglishDubbing,
      finalVideo: runFinalVideo,
    };
    handlers[actionId]?.();
  };
  const PageContainer = embedded ? "section" : "main";

  return (
    <PageContainer
      className={`detail-page ${embedded ? "embedded-production-flow" : ""}`}
      aria-label={embedded ? "完整制作流程" : undefined}
    >
      {!embedded && (
        <>
          <header className="detail-header">
            <div>
              <p className="eyebrow">视频项目</p>
              <h1>{record.name}</h1>
              <p className="file-meta">
                {formatSize(record.size)} · {record.type || "视频文件"} ·
                {record.storageMode === "reference" ? " 原路径引用" : " 旧版复制记录"}
              </p>
              <p
                className={`project-path ${record.sourcePath ? "" : "warning"}`}
                title={record.sourcePath || sourceDisplayName}
              >
                原视频：{sourceDisplayName}
              </p>
            </div>
            <div className="detail-header-actions">
              <span className={`phase-tag ${record.storageMode === "reference" ? "" : "warning"}`}>
                {record.storageMode === "reference" ? "原路径已记录" : "待重新选择原视频"}
              </span>
              <button
                className="secondary-button compact"
                disabled={isReplacingSource}
                type="button"
                onClick={replaceProjectSource}
              >
                {isReplacingSource ? "等待选择..." : "重新选择原视频"}
              </button>
            </div>
          </header>
          {sourceReplaceMessage && <p className="copy-status">{sourceReplaceMessage}</p>}
          <ProjectWorkflowOverview
            overview={workflowOverview}
            nextDisabled={Boolean(
              workflowOverview.nextAction &&
              overviewActionDisabledById[workflowOverview.nextAction.id],
            )}
            onRunNext={runOverviewNext}
            onStepSelect={scrollToWorkflowStep}
          />
        </>
      )}
      {openPathError && <p className="workflow-error page-error">{openPathError}</p>}
      <section className="project-content">
        {!embedded && (
          <WorkflowStageSection group={workflowStageById.assets}>
            <div className="workflow-card" id="workflow-step-separation">
              <p className="eyebrow">步骤 01</p>
              <h2>BS-RoFormer 二轨分离</h2>
              <p>从原视频生成 DX 对白轨与 MX+FX 背景轨，为后续字幕与配音阶段提供素材。</p>
              <div className={`step-status ${separation?.status || "ready"}`}>
                <strong>
                  {separation?.status === "running" && "正在处理"}
                  {separation?.status === "completed" && "已生成二轨"}
                  {separation?.status === "failed" && "处理失败"}
                  {separation?.status === "cancelled" && "已取消"}
                  {separation?.status === "unavailable" && "不可执行"}
                  {(!separation || separation.status === "ready") && "等待开始"}
                </strong>
                <small>
                  {separation?.status === "running" &&
                    "音轨分离正在后台执行，页面会自动刷新状态。"}
                  {separation?.status === "failed" &&
                    "上次处理失败，请查看下方错误信息后重新执行。"}
                  {separation?.status === "cancelled" && "任务已取消，可以重新执行。"}
                  {separation?.status === "unavailable" && "请先在页面顶部重新选择原视频。"}
                  {separation?.status !== "running" &&
                    separation?.status !== "failed" &&
                    separation?.status !== "cancelled" &&
                    separation?.status !== "unavailable" &&
                    "输出将写入原视频同级目录。"}
                </small>
              </div>
              <DirectoryResult
                artifactKey="bsRoformer.outputDirectory"
                label="输出目录"
                path={separation?.outputDirectory}
                ready={separation?.outputDirectoryReady}
                onOpen={openPath}
              />
              {separation?.outputs && (
                <div className="track-results">
                  <FileResult artifactKey="bsRoformer.dialogue" label="DX 对白轨" file={separation.outputs.dialogue} onOpen={openPath} />
                  <FileResult artifactKey="bsRoformer.background" label="MX+FX 背景轨" file={separation.outputs.background} onOpen={openPath} />
                </div>
              )}
              {separationError && <p className="workflow-error">{separationError}</p>}
              {separation?.error && <p className="workflow-error">{separation.error}</p>}
              <button
                className="primary-button workflow-action"
                disabled={
                  isStartingSeparation ||
                  separation?.status === "running" ||
                  sourceActionDisabled
                }
                type="button"
                onClick={runSeparation}
              >
                {separation?.status === "running"
                  ? "处理中..."
                  : separation?.status === "completed"
                    ? "重新生成二轨"
                    : "开始二轨分离"}
              </button>
              <CancelTaskButton
                busy={cancellingWorkflow === "bs-roformer"}
                visible={separation?.status === "running"}
                onClick={() =>
                  cancelWorkflow(
                    "bs-roformer",
                    "bs-roformer",
                    setSeparation,
                    setSeparationError,
                  )
                }
              />
            </div>
            <div className="workflow-card" id="workflow-step-ocr">
              <p className="eyebrow">步骤 02</p>
              <h2>GPU OCR + FunASR 标点恢复</h2>
              <p>从视频画面的硬字幕提取中文字幕，并恢复标点，生成可用于后续处理的 OCR 字幕。</p>
              <div className={`step-status ${ocr?.status || "ready"}`}>
                <strong>
                  {ocr?.status === "running" &&
                    (ocr.stage === "punctuation" ? "正在恢复标点" : "正在提取字幕")}
                  {ocr?.status === "completed" && "OCR 字幕已生成"}
                  {ocr?.status === "failed" && "处理失败"}
                  {ocr?.status === "cancelled" && "已取消"}
                  {ocr?.status === "unavailable" && "不可执行"}
                  {(!ocr || ocr.status === "ready") && "等待开始"}
                </strong>
                <small>
                  {ocr?.status === "running" &&
                    (ocr.stage === "punctuation"
                      ? "GPU OCR 已完成，正在执行 FunASR 标点恢复。"
                      : "GPU OCR 正在读取画面字幕，页面会自动刷新状态。")}
                  {ocr?.status === "failed" &&
                    "上次处理失败，请查看下方错误信息后重新执行。"}
                  {ocr?.status === "cancelled" && "任务已取消，可以重新执行。"}
                  {ocr?.status === "unavailable" && "请先在页面顶部重新选择原视频。"}
                  {ocr?.status !== "running" &&
                    ocr?.status !== "failed" &&
                    ocr?.status !== "cancelled" &&
                    ocr?.status !== "unavailable" &&
                    "字幕结果将写入原视频同级目录。"}
                </small>
              </div>
              <DirectoryResult
                artifactKey="ocr.outputDirectory"
                label="输出目录"
                path={ocr?.outputDirectory}
                ready={ocr?.outputDirectoryReady}
                onOpen={openPath}
              />
              {ocr?.outputs && (
                <div className="track-results">
                  <FileResult artifactKey="ocr.srt" label="OCR 字幕 SRT" file={ocr.outputs.srt} onOpen={openPath} />
                  <FileResult artifactKey="ocr.report" label="OCR 质量报告" file={ocr.outputs.report} onOpen={openPath} />
                </div>
              )}
              {ocrError && <p className="workflow-error">{ocrError}</p>}
              {ocr?.error && <p className="workflow-error">{ocr.error}</p>}
              <button
                className="primary-button workflow-action"
                disabled={
                  isStartingOcr ||
                  ocr?.status === "running" ||
                  sourceActionDisabled
                }
                type="button"
                onClick={runOcr}
              >
                {ocr?.status === "running"
                  ? "处理中..."
                  : ocr?.status === "completed"
                    ? "重新生成 OCR 字幕"
                    : "开始提取 OCR 字幕"}
              </button>
              <CancelTaskButton
                busy={cancellingWorkflow === "ocr-subtitles"}
                visible={ocr?.status === "running"}
                onClick={() =>
                  cancelWorkflow(
                    "ocr-subtitles",
                    "ocr-subtitles",
                    setOcr,
                    setOcrError,
                  )
                }
              />
            </div>
            <div className="workflow-card" id="workflow-step-speakers">
              <p className="eyebrow">步骤 03</p>
              <h2>WhisperX 候选说话人</h2>
              <p>读取 DX 对白轨进行中文转写、时间对齐和候选说话人区分，为字幕角色归属提供参考。</p>
              <div className={`step-status ${speakers?.status || "blocked"}`}>
                <strong>
                  {speakers?.status === "running" && "正在提取候选说话人"}
                  {speakers?.status === "completed" && "候选说话人字幕已生成"}
                  {speakers?.status === "failed" && "处理失败"}
                  {speakers?.status === "cancelled" && "已取消"}
                  {speakers?.status === "unavailable" && "不可执行"}
                  {(!speakers || speakers.status === "blocked") && "等待 DX 对白轨"}
                  {speakers?.status === "ready" && "可以开始"}
                </strong>
                <small>
                  {speakers?.status === "running"
                    ? "WhisperX 正在后台执行，页面会自动刷新状态。"
                    : speakers?.status === "cancelled"
                      ? "任务已取消，可以重新执行。"
                      : speakers?.status === "failed"
                        ? "WhisperX 上次执行失败，可以查看错误信息后重新执行。"
                        : speakers?.canRun
                          ? "已检测到 DX 对白轨，可以执行 WhisperX。"
                          : "请先完成步骤 01，生成 DX 对白轨。"}
                </small>
              </div>
              <div className="track-results input-results">
                <FileResult
                  artifactKey="whisperx.input"
                  label="输入音轨"
                  file={{ path: speakers?.inputPath, ready: speakers?.canRun }}
                  onOpen={openPath}
                  readyText="已就绪"
                />
              </div>
              <DirectoryResult
                artifactKey="whisperx.outputDirectory"
                label="输出目录"
                path={speakers?.outputDirectory}
                ready={speakers?.outputDirectoryReady}
                onOpen={openPath}
              />
              {speakers?.outputs && (
                <div className="track-results">
                  <FileResult artifactKey="whisperx.srt" label="Speaker_Diarization SRT" file={speakers.outputs.srt} onOpen={openPath} />
                  <FileResult artifactKey="whisperx.json" label="Speaker_Diarization JSON" file={speakers.outputs.json} onOpen={openPath} />
                </div>
              )}
              {speakersError && <p className="workflow-error">{speakersError}</p>}
              {speakers?.error && <p className="workflow-error">{speakers.error}</p>}
              <button
                className="primary-button workflow-action"
                disabled={
                  isStartingSpeakers ||
                  speakers?.status === "running" ||
                  !speakers?.canRun ||
                  record.storageMode !== "reference"
                }
                type="button"
                onClick={runSpeakers}
              >
                {speakers?.status === "running"
                  ? "处理中..."
                  : speakers?.status === "completed"
                    ? "重新生成候选说话人"
                    : "开始提取候选说话人"}
              </button>
              <CancelTaskButton
                busy={cancellingWorkflow === "whisperx-speakers"}
                visible={speakers?.status === "running"}
                onClick={() =>
                  cancelWorkflow(
                    "whisperx-speakers",
                    "whisperx-speakers",
                    setSpeakers,
                    setSpeakersError,
                  )
                }
              />
            </div>
          </WorkflowStageSection>
        )}
        {(!embedded || visiblePanel === "translation") && (
          <WorkflowStageSection group={workflowStageById.subtitles}>
            {!embedded && (
              <div className="workflow-card" id="workflow-step-finalSubtitles">
                <p className="eyebrow">步骤 04</p>
                <h2>合并最终中文字幕</h2>
                <p>将 OCR 标点字幕作为正文，合并 WhisperX 候选说话人标记，生成完整中文字幕文件。</p>
                <div className={`step-status ${finalSubtitles?.status || "blocked"}`}>
                  <strong>
                    {finalSubtitles?.status === "running" && "正在合并字幕"}
                    {finalSubtitles?.status === "completed" && "最终中文字幕已生成"}
                    {finalSubtitles?.status === "failed" && "合并失败"}
                    {finalSubtitles?.status === "cancelled" && "已取消"}
                    {finalSubtitles?.status === "unavailable" && "不可执行"}
                    {(!finalSubtitles || finalSubtitles.status === "blocked") && "等待合并输入"}
                    {finalSubtitles?.status === "ready" && "可以开始"}
                  </strong>
                  <small>
                    {finalSubtitles?.status === "running"
                      ? "正在将 OCR 字幕与候选说话人字幕合并。"
                      : finalSubtitles?.status === "cancelled"
                        ? "任务已取消，可以重新执行。"
                        : finalSubtitles?.canRun
                          ? "两项 SRT 输入文件已齐全，可以生成完整中文字幕。"
                          : "需先生成 WhisperX SRT 与 OCR 标点修复 SRT。"}
                  </small>
                </div>
                {finalSubtitles?.inputs && (
                  <div className="track-results input-results">
                    <FileResult artifactKey="whisperx.srt" label="WhisperX SRT" file={finalSubtitles.inputs.speakerSrt} onOpen={openPath} readyText="已就绪" />
                    <FileResult artifactKey="ocr.srt" label="OCR 标点修复 SRT" file={finalSubtitles.inputs.ocrSrt} onOpen={openPath} readyText="已就绪" />
                  </div>
                )}
                <DirectoryResult
                  artifactKey="finalSubtitles.outputDirectory"
                  label="输出目录"
                  path={finalSubtitles?.outputDirectory}
                  ready={finalSubtitles?.outputDirectoryReady}
                  onOpen={openPath}
                />
                {finalSubtitles?.outputs && (
                  <div className="track-results">
                    <FileResult artifactKey="finalSubtitles.srt" label="最终中文字幕 SRT" file={finalSubtitles.outputs.srt} onOpen={openPath} />
                  </div>
                )}
                {finalSubtitlesError && <p className="workflow-error">{finalSubtitlesError}</p>}
                {finalSubtitles?.error && <p className="workflow-error">{finalSubtitles.error}</p>}
                <button
                  className="primary-button workflow-action"
                  disabled={
                    isStartingFinalSubtitles ||
                    finalSubtitles?.status === "running" ||
                    !finalSubtitles?.canRun ||
                    record.storageMode !== "reference"
                  }
                  type="button"
                  onClick={runFinalSubtitles}
                >
                  {finalSubtitles?.status === "running"
                    ? "合并中..."
                    : finalSubtitles?.status === "completed"
                      ? "重新生成最终中文字幕"
                      : "生成最终中文字幕"}
                </button>
                <CancelTaskButton
                  busy={cancellingWorkflow === "final-subtitles"}
                  visible={finalSubtitles?.status === "running"}
                  onClick={() =>
                    cancelWorkflow(
                      "final-subtitles",
                      "final-subtitles",
                      setFinalSubtitles,
                      setFinalSubtitlesError,
                    )
                  }
                />
              </div>
            )}
            <div className="workflow-card manual-step" id="workflow-step-translation">
              <h2>翻译校对</h2>
              {canTranslate && subtitleEditor?.canEdit && (
                <>
                  {pendingEnglishNumbers.length > 0 && (
                    <p className="subtitle-editor-missing">
                      待处理英文：{pendingEnglishNumbers.join("、")}
                    </p>
                  )}
                  {subtitleEditor.draftError && <p className="workflow-error">{subtitleEditor.draftError}</p>}
                  <section className="translation-assistant-panel" aria-label="Gemini 翻译提示词">
                    <strong>Gemini 翻译提示词</strong>
                    <div className="translation-assistant-actions">
                      <button className="secondary-button compact" type="button" onClick={copyTranslationPrompt}>
                        复制当前提示词
                      </button>
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => setTranslationPromptVisible((visible) => !visible)}
                      >
                        {translationPromptVisible ? "收起提示词" : "查看提示词"}
                      </button>
                    </div>
                    {translationPromptVisible && (
                      <textarea
                        className="translation-prompt"
                        rows={12}
                        value={translationPrompt}
                        onChange={(event) => setTranslationPromptText(event.target.value)}
                      />
                    )}
                  </section>
                  <section className="translation-import-panel" aria-label="读取 Gemini 翻译">
                    <button
                      className="secondary-button compact"
                      disabled={isImportingTranslationSrt}
                      type="button"
                      onClick={importTranslationSrt}
                    >
                      {isImportingTranslationSrt ? "正在读取..." : "读取 Gemini 输出"}
                    </button>
                  </section>
                  <div className="subtitle-editor-table" role="table" aria-label="字幕翻译与角色校对">
                    <div className="subtitle-editor-header" role="row">
                      <span>时间 / 中文</span>
                      <span>角色</span>
                      <span>英文字幕</span>
                    </div>
                    {subtitleEditorCues.map((cue) => (
                      <div className="subtitle-editor-row" role="row" key={cue.number}>
                        <div className="subtitle-source">
                          <strong>{String(cue.number).padStart(3, "0")} · {cue.start} - {cue.end}</strong>
                          <p>{cue.chinese}</p>
                        </div>
                        <div className="subtitle-role-field">
                          <input
                            aria-label={`第 ${cue.number} 条角色`}
                            type="text"
                            value={cue.role}
                            onChange={(event) => updateSubtitleCue(cue.number, "role", event.target.value)}
                          />
                          <button
                            className="role-apply-button"
                            type="button"
                            onClick={() => applyRoleToMatchingCues(cue.number)}
                          >
                            应用到同角色
                          </button>
                        </div>
                        <textarea
                          aria-label={`第 ${cue.number} 条英文字幕`}
                          rows={2}
                          value={cue.english}
                          onChange={(event) => updateSubtitleCue(cue.number, "english", event.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {subtitleEditorError && <p className="workflow-error">{subtitleEditorError}</p>}
                  {subtitleEditorMessage && <p className="copy-status">{subtitleEditorMessage}</p>}
                  <div className="subtitle-editor-actions">
                    <FileResult
                      artifactKey="translation.geminiJson"
                      label="Gemini 翻译 JSON"
                      file={{
                        path: finalSubtitles.translationTarget.jsonPath,
                        ready: finalSubtitles.translationTarget.jsonReady,
                      }}
                      onOpen={openPath}
                    />
                    <FileResult
                      artifactKey="translation.englishDraftSrt"
                      label="英文显示字幕 SRT"
                      file={{
                        path: finalSubtitles.translationTarget.srtPath,
                        ready: finalSubtitles.translationTarget.srtReady,
                      }}
                      onOpen={openPath}
                    />
                    <button
                      className="primary-button"
                      disabled={isSavingSubtitleEditor || subtitleEditorCues.length === 0}
                      type="button"
                      onClick={saveSubtitleEdits}
                    >
                      {isSavingSubtitleEditor
                        ? "正在保存..."
                        : subtitleEditorComplete
                          ? "保存并完成英文字幕"
                          : "保存编辑进度"}
                    </button>
                  </div>
                </>
              )}
              {canTranslate && !subtitleEditor && !subtitleEditorError && (
                <p className="copy-status">正在读取字幕编辑数据...</p>
              )}
              {subtitleEditorError && !subtitleEditor?.canEdit && (
                <p className="workflow-error">{subtitleEditorError}</p>
              )}
            </div>
          </WorkflowStageSection>
        )}
        {(!embedded || visiblePanel === "englishDubbing") && (
          <WorkflowStageSection group={workflowStageById.dubbing}>
            <div className="workflow-card manual-step" id="workflow-step-englishDubbing">
              <h2>英文配音</h2>
              <div className={`step-status ${englishDubbing?.status || "blocked"}`}>
                <strong>
                  {englishDubbing?.status === "running" &&
                    englishDubbing.stage === "preflight" &&
                    "正在预检英文字幕"}
                  {englishDubbing?.status === "running" &&
                    englishDubbing.stage === "dubbing-groups" &&
                    "正在规划英文整句分段"}
                  {englishDubbing?.status === "running" &&
                    englishDubbing.stage === "segments" &&
                    "正在按整句分段切割 DX 对白轨"}
                  {englishDubbing?.status === "running" &&
                    englishDubbing.stage === "dubbing" &&
                    "正在使用 VoxCPM 生成英文配音"}
                  {englishDubbing?.status === "running" &&
                    englishDubbing.stage === "redubbing" &&
                    `正在重新配音第 ${String(englishDubbing.activeSegmentNumber || "").padStart(3, "0")} 条`}
                  {englishDubbing?.status === "running" &&
                    englishDubbing.stage === "mixing" &&
                    "正在合成英文混音"}
                  {englishDubbing?.status === "completed" && "英文成片混音已生成"}
                  {englishDubbing?.status === "failed" && "处理失败"}
                  {englishDubbing?.status === "cancelled" && "已取消"}
                  {englishDubbing?.status === "unavailable" && "不可执行"}
                  {(!englishDubbing || englishDubbing.status === "blocked") && "等待英文字幕与音轨"}
                  {englishDubbing?.status === "ready" && "可以开始"}
                </strong>
              </div>
              <DubbingProgress progress={englishDubbing?.dubbingProgress} />
              {englishDubbingError && <p className="workflow-error">{englishDubbingError}</p>}
              {englishDubbing?.error && <p className="workflow-error">{englishDubbing.error}</p>}
              <button
                className="primary-button workflow-action"
                disabled={
                  isStartingEnglishDubbing ||
                  englishDubbing?.status === "running" ||
                  !englishDubbing?.canRun ||
                  record.storageMode !== "reference"
                }
                type="button"
                onClick={runEnglishDubbing}
              >
                {englishDubbing?.status === "running"
                  ? "处理中..."
                  : englishDubbing?.status === "completed"
                    ? "重新生成英文混音"
                    : "开始英文配音与混音"}
              </button>
              <CancelTaskButton
                busy={cancellingWorkflow === "english-dubbing-mix"}
                visible={englishDubbing?.status === "running"}
                onClick={() =>
                  cancelWorkflow(
                    "english-dubbing-mix",
                    "english-dubbing-mix",
                    setEnglishDubbing,
                    setEnglishDubbingError,
                  )
                }
              />
              <DubbingSegmentEditorPanel
                segments={dubbingSegments}
                selectedSegment={selectedDubbingSegment}
                draft={dubbingSegmentDraft}
                message={dubbingSegmentMessage}
                versionKey={englishDubbing?.finishedAt || englishDubbing?.startedAt || ""}
                disabled={englishDubbing?.status === "running" || record.storageMode !== "reference"}
                busy={isRegeneratingDubbingSegment}
                onSelect={(segment) => {
                  setSelectedDubbingSegmentNumber(segment.number);
                  setDubbingSegmentDraft(dubbingSegmentDraftFrom(segment));
                  setDubbingSegmentMessage("");
                }}
                onDraftChange={setDubbingSegmentDraft}
                onChooseReferenceAudio={chooseDubbingReferenceAudio}
                onRegenerate={regenerateDubbingSegment}
              />
            </div>
          </WorkflowStageSection>
        )}
        {(!embedded || visiblePanel === "finalVideo") && (
          <WorkflowStageSection group={workflowStageById.delivery}>
            <div className="workflow-card manual-step final-video-step" id="workflow-step-finalVideo">
              <h2>导出成片</h2>
              {finalVideo?.status !== "ready" && (
                <div className={`step-status ${finalVideo?.status || "blocked"}`}>
                  <strong>
                    {finalVideo?.status === "running" && "正在生成最终成片"}
                    {finalVideo?.status === "completed" && "最终英文成片已生成"}
                    {finalVideo?.status === "failed" && "成片生成失败"}
                    {finalVideo?.status === "cancelled" && "已取消"}
                    {finalVideo?.status === "unavailable" && "不可执行"}
                    {(!finalVideo || finalVideo.status === "blocked") && "等待英文混音与字幕"}
                  </strong>
                </div>
              )}
              <section className="subtitle-style-panel" aria-label="英文字幕样式设置">
                <div className="style-panel-heading">
                  <strong>字幕样式</strong>
                </div>
                <div className="style-controls">
                  <label className="style-field font-field">
                    <span>字体</span>
                    <input
                      type="text"
                      value={finalVideoStyle.fontName}
                      onChange={(event) => updateFinalVideoStyle("fontName", event.target.value)}
                    />
                  </label>
                  <label className="style-field">
                    <span>字体大小</span>
                    <input
                      min="18"
                      max="96"
                      type="number"
                      value={finalVideoStyle.fontSize}
                      onChange={(event) => updateFinalVideoStyle("fontSize", Number(event.target.value))}
                    />
                  </label>
                  <label className="style-field color-field">
                    <span>字幕颜色</span>
                    <input
                      type="color"
                      value={finalVideoStyle.textColor}
                      onChange={(event) => updateFinalVideoStyle("textColor", event.target.value)}
                    />
                    <code>{finalVideoStyle.textColor}</code>
                  </label>
                  <label className="style-field color-field">
                    <span>背景颜色</span>
                    <input
                      type="color"
                      value={finalVideoStyle.backgroundColor}
                      onChange={(event) => updateFinalVideoStyle("backgroundColor", event.target.value)}
                    />
                    <code>{finalVideoStyle.backgroundColor}</code>
                  </label>
                  <label className="style-field range-field">
                    <span>背景不透明度 <strong>{Math.round(finalVideoStyle.backgroundOpacity * 100)}%</strong></span>
                    <input
                      min="0"
                      max="1"
                      step="0.01"
                      type="range"
                      value={finalVideoStyle.backgroundOpacity}
                      onChange={(event) =>
                        updateFinalVideoStyle("backgroundOpacity", Number(event.target.value))
                      }
                    />
                  </label>
                  <div className="style-field subtitle-position-readout">
                    <span>字幕位置</span>
                    <strong>
                      X {Math.round(finalVideoStyle.positionX)}% · Y {Math.round(finalVideoStyle.positionY)}%
                    </strong>
                  </div>
                </div>
                {!finalVideo?.previews?.some((preview) => preview.ready) && (
                  <button
                    className="secondary-button preview-action"
                    disabled={isGeneratingFinalVideoPreview || !finalVideo?.canPreview}
                    type="button"
                    onClick={generateFinalVideoPreview}
                  >
                    {isGeneratingFinalVideoPreview ? "正在载入画面..." : "载入字幕编辑画面"}
                  </button>
                )}
                {finalVideo?.previews?.some((preview) => preview.ready) && (
                  <div className="preview-grid">
                    {finalVideo.previews
                      .filter((preview) => preview.ready)
                      .slice(0, 1)
                      .map((preview) => (
                        <SubtitlePreviewFigure
                          key={preview.path}
                          preview={preview}
                          previewVersion={previewVersion}
                          previewText={
                            subtitleEditorCues.find(
                              (cue) => cue.english.trim() && !cue.skipped,
                            )?.english.trim() || "Drag this subtitle to place it"
                          }
                          style={finalVideoStyle}
                          onStyleChange={updateFinalVideoStyleValues}
                        />
                      ))}
                  </div>
                )}
              </section>
              {finalVideoError && <p className="workflow-error">{finalVideoError}</p>}
              {finalVideo?.error && <p className="workflow-error">{finalVideo.error}</p>}
              <button
                className="primary-button workflow-action"
                disabled={
                  isStartingFinalVideo ||
                  finalVideo?.status === "running" ||
                  !finalVideo?.canRun ||
                  record.storageMode !== "reference"
                }
                type="button"
                onClick={runFinalVideo}
              >
                {finalVideo?.status === "running"
                  ? "生成成片中..."
                  : finalVideo?.status === "completed"
                    ? "按当前样式重新生成最终成片"
                    : "替换音频并生成最终成片"}
              </button>
              <CancelTaskButton
                busy={cancellingWorkflow === "final-video"}
                visible={finalVideo?.status === "running"}
                onClick={() =>
                  cancelWorkflow(
                    "final-video",
                    "final-video",
                    setFinalVideo,
                    setFinalVideoError,
                  )
                }
              />
            </div>
          </WorkflowStageSection>
        )}
        {(!embedded || visiblePanel === "finalValidation") && (
          <WorkflowStageSection group={workflowStageById.validation}>
            <div
              className="workflow-card manual-step final-validation-step"
              id="workflow-step-finalValidation"
            >
              <h2>最终验证</h2>
              {finalVideo?.outputs?.video?.ready ? (
                <>
                  <section className="final-video-player-shell" aria-label="最终成片播放器">
                    <video
                      ref={finalValidationVideoRef}
                      className="final-video-player"
                      controls
                      preload="metadata"
                      src={`/api/videos/${record.id}/workflow/final-validation/content?v=${finalValidation?.finishedAt || validationVideoVersion || finalVideo.finishedAt || ""}`}
                      onLoadedMetadata={restoreFinalValidationPlaybackTime}
                      onTimeUpdate={(event) => setValidationCurrentTime(event.currentTarget.currentTime)}
                    >
                      当前环境不支持视频播放。
                    </video>
                  </section>

                  <section className="validation-range-editor" aria-label="最终验证时间段设置">
                    <div className="validation-time-readout">
                      <span>当前播放位置</span>
                      <strong>{formatTimelineSeconds(validationCurrentTime)}</strong>
                    </div>
                    <div className="validation-boundary-controls">
                      <label>
                        <span>开始时间（秒）</span>
                        <input
                          min="0"
                          step="0.001"
                          type="number"
                          value={validationRangeStart}
                          onChange={(event) => setValidationRangeStart(event.target.value)}
                        />
                        <button
                          className="secondary-button compact"
                          type="button"
                          onClick={() => setValidationBoundary("start")}
                        >
                          设为开始
                        </button>
                      </label>
                      <label>
                        <span>结束时间（秒）</span>
                        <input
                          min="0"
                          step="0.001"
                          type="number"
                          value={validationRangeEnd}
                          onChange={(event) => setValidationRangeEnd(event.target.value)}
                        />
                        <button
                          className="secondary-button compact"
                          type="button"
                          onClick={() => setValidationBoundary("end")}
                        >
                          设为结束
                        </button>
                      </label>
                    </div>

                    <div className="validation-range-columns">
                      <section className="validation-range-panel">
                        <header>
                          <div>
                            <strong>使用原视频音频</strong>
                            <span>该时间段直接使用原视频声音，覆盖英文混音。</span>
                          </div>
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() => addValidationRange(setSourceAudioRanges)}
                          >
                            添加时间段
                          </button>
                        </header>
                        {sourceAudioRanges.length === 0 ? (
                          <p>暂无时间段</p>
                        ) : (
                          <ol>
                            {sourceAudioRanges.map((range, index) => (
                              <li key={`${range.start}-${range.end}`}>
                                <span>
                                  {formatTimelineSeconds(range.start)} - {formatTimelineSeconds(range.end)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeValidationRange(setSourceAudioRanges, index)}
                                >
                                  删除
                                </button>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>

                      <section className="validation-range-panel">
                        <header>
                          <div>
                            <strong>清除 MX+FX 背景底轨</strong>
                            <span>该时间段静音无对白背景底轨，保留英文对白。</span>
                          </div>
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() => addValidationRange(setMutedBackgroundRanges)}
                          >
                            添加时间段
                          </button>
                        </header>
                        {mutedBackgroundRanges.length === 0 ? (
                          <p>暂无时间段</p>
                        ) : (
                          <ol>
                            {mutedBackgroundRanges.map((range, index) => (
                              <li key={`${range.start}-${range.end}`}>
                                <span>
                                  {formatTimelineSeconds(range.start)} - {formatTimelineSeconds(range.end)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeValidationRange(setMutedBackgroundRanges, index)}
                                >
                                  删除
                                </button>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                    </div>
                  </section>
                </>
              ) : (
                <p className="copy-status">请先在第五步生成最终成片。</p>
              )}

              {finalValidation?.status === "running" && (
                <div className="step-status running"><strong>正在生成验证成片</strong></div>
              )}
              {validationDirty && (
                <p className="copy-status">时间段已修改，点击下方按钮应用到最终成片。</p>
              )}
              {finalValidation?.status === "completed" && !validationDirty && (
                <div className="step-status completed"><strong>最终验证成片已生成</strong></div>
              )}
              {finalValidationError && <p className="workflow-error">{finalValidationError}</p>}
              {finalValidation?.error && <p className="workflow-error">{finalValidation.error}</p>}
              <button
                className="primary-button workflow-action"
                disabled={
                  isStartingFinalValidation ||
                  finalValidation?.status === "running" ||
                  !finalValidation?.canRun ||
                  record.storageMode !== "reference"
                }
                type="button"
                onClick={runFinalValidation}
              >
                {finalValidation?.status === "running"
                  ? "合成中..."
                  : validationDirty
                    ? "应用修改并重新生成"
                    : finalValidation?.status === "completed"
                    ? "按当前时间段重新生成"
                    : "生成最终验证成片"}
              </button>
              <CancelTaskButton
                busy={cancellingWorkflow === "final-validation"}
                visible={finalValidation?.status === "running"}
                onClick={() =>
                  cancelWorkflow(
                    "final-validation",
                    "final-validation",
                    setFinalValidation,
                    setFinalValidationError,
                  )
                }
              />
            </div>
          </WorkflowStageSection>
        )}
      </section>
    </PageContainer>
  );
}

function App() {
  const [videos, setVideos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showPathDialog, setShowPathDialog] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [message, setMessage] = useState("");
  const [isSelectingSource, setIsSelectingSource] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState(null);
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const navigate = useNavigate();
  const desktopBridge = window.desktopApp;
  const isDesktop = Boolean(desktopBridge?.isDesktop);

  const loadVideos = useCallback(async () => {
    setIsLoading(true);
    try {
      setVideos(await requestJson("/api/videos"));
      setMessage("");
    } catch (error) {
      setMessage(`视频列表读取失败：${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  useEffect(() => {
    if (!desktopBridge) {
      return undefined;
    }
    let active = true;
    desktopBridge.getInfo().then((info) => {
      if (active) {
        setDesktopInfo(info);
      }
    }).catch((error) => setMessage(`桌面应用信息读取失败：${error.message}`));
    return () => {
      active = false;
    };
  }, [desktopBridge]);

  const handleRegister = async () => {
    if (!sourcePath.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      const selected = await requestJson("/api/videos/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath }),
      });
      await loadVideos();
      setSourcePath("");
      setShowPathDialog(false);
      navigate(`/video/${selected.id}`);
    } catch (error) {
      setMessage(`原视频路径记录失败：${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectSource = async () => {
    setIsSelectingSource(true);
    setMessage("");
    try {
      const selected = await requestJson("/api/videos/select-source", {
        method: "POST",
      });
      if (!selected) {
        setMessage("已取消选择原视频。");
        return;
      }
      await loadVideos();
      setSourcePath("");
      setShowPathDialog(false);
      navigate(`/video/${selected.id}`);
    } catch (error) {
      setMessage(`选择原视频失败：${error.message}`);
    } finally {
      setIsSelectingSource(false);
    }
  };

  const handleDelete = async (id) => {
    const video = videos.find((item) => item.id === id);
    if (!window.confirm(`从项目列表移除“${video?.name || "该视频"}”？\n\n不会删除原视频文件。`)) {
      return;
    }
    try {
      await requestJson(`/api/videos/${id}`, { method: "DELETE" });
      await loadVideos();
      navigate("/");
    } catch (error) {
      setMessage(`视频删除失败：${error.message}`);
    }
  };

  return (
    <div className={`app-shell ${isDesktop ? "desktop-mode" : "browser-mode"}`}>
      {isDesktop && (
        <DesktopTitlebar
          desktopInfo={desktopInfo}
          onOpenSettings={() => setShowDesktopSettings(true)}
        />
      )}
      <div className="application">
        <Sidebar
          videos={videos}
          isLoading={isLoading}
          isAddingVideo={isSaving || isSelectingSource}
          isDesktop={isDesktop}
          onAddPath={() => setShowPathDialog(true)}
          onDelete={handleDelete}
          onOpenSettings={() => setShowDesktopSettings(true)}
        />
        {showPathDialog && (
          <PathDialog
            isSaving={isSaving}
            isSelectingSource={isSelectingSource}
            value={sourcePath}
            onChange={setSourcePath}
            onClose={() => {
              if (!isSaving && !isSelectingSource) {
                setShowPathDialog(false);
              }
            }}
            onSelectSource={handleSelectSource}
            onSubmit={handleRegister}
          />
        )}
        {showDesktopSettings && (
          <DesktopSettingsDialog
            info={desktopInfo}
            onClose={() => setShowDesktopSettings(false)}
            onOpenDirectory={(kind) => desktopBridge.openDirectory(kind)}
            onChooseRuntime={() => desktopBridge.chooseRuntimeDirectory()}
          />
        )}
        {message && <div className="toast">{message}</div>}
        <Routes>
          <Route
            path="/"
            element={
              <WelcomePage
                videos={videos}
                isAddingVideo={isSaving || isSelectingSource}
                onAddPath={() => setShowPathDialog(true)}
              />
            }
          />
          <Route path="/video/:videoId" element={<SimplifiedVideoPage videos={videos} isLoading={isLoading} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
