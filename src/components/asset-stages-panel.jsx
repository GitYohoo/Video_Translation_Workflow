import { DirectoryResult, FileResult } from "./artifact-results.jsx";
import { CancelTaskButton, WorkflowStageSection } from "./workflow-ui.jsx";
import { workflowStageById } from "../workflow-stage.js";

export function AssetStagesPanel({ model, actions }) {
  const {
    cancellingWorkflow,
    isStartingOcr,
    isStartingSeparation,
    isStartingSpeakers,
    ocr,
    ocrError,
    record,
    separation,
    separationError,
    sourceActionDisabled,
    speakers,
    speakersError,
  } = model;
  const {
    cancelWorkflow,
    openPath,
    runOcr,
    runSeparation,
    runSpeakers,
    setOcr,
    setOcrError,
    setSeparation,
    setSeparationError,
    setSpeakers,
    setSpeakersError,
  } = actions;

  return (
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
  );
}

