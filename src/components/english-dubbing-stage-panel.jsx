import { DubbingProgress } from "./artifact-results.jsx";
import { DubbingSegmentEditorPanel } from "./dubbing-segment-editor-panel.jsx";
import { CancelTaskButton, WorkflowStageSection } from "./workflow-ui.jsx";
import { dubbingSegmentDraftFrom } from "../dubbing-utils.js";
import { workflowStageById } from "../workflow-stage.js";

export function EnglishDubbingStagePanel({ model, actions }) {
  const {
    cancellingWorkflow,
    dubbingSegmentDraft,
    dubbingSegmentMessage,
    dubbingSegments,
    englishDubbing,
    englishDubbingError,
    isRegeneratingDubbingSegment,
    isStartingEnglishDubbing,
    record,
    selectedDubbingSegment,
  } = model;
  const {
    cancelWorkflow,
    chooseDubbingReferenceAudio,
    regenerateDubbingSegment,
    runEnglishDubbing,
    setDubbingSegmentDraft,
    setDubbingSegmentMessage,
    setEnglishDubbing,
    setEnglishDubbingError,
    setSelectedDubbingSegmentNumber,
  } = actions;

  return (
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
  );
}

