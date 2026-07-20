import { CancelTaskButton, WorkflowStageSection } from "./workflow-ui.jsx";
import { formatTimelineSeconds } from "../subtitle-editor-utils.js";
import { workflowStageById } from "../workflow-stage.js";

export function FinalValidationStagePanel({ model, actions }) {
  const {
    cancellingWorkflow,
    finalValidation,
    finalValidationError,
    finalValidationVideoRef,
    finalVideo,
    isStartingFinalValidation,
    mutedBackgroundRanges,
    record,
    sourceAudioRanges,
    validationCurrentTime,
    validationDirty,
    validationRangeEnd,
    validationRangeStart,
    validationVideoVersion,
  } = model;
  const {
    addValidationRange,
    cancelWorkflow,
    removeValidationRange,
    restoreFinalValidationPlaybackTime,
    runFinalValidation,
    setFinalValidation,
    setFinalValidationError,
    setMutedBackgroundRanges,
    setSourceAudioRanges,
    setValidationBoundary,
    setValidationCurrentTime,
    setValidationRangeEnd,
    setValidationRangeStart,
  } = actions;

  return (
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
  );
}

