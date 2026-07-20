import { SubtitlePreviewFigure } from "./subtitle-preview-figure.jsx";
import { CancelTaskButton, WorkflowStageSection } from "./workflow-ui.jsx";
import { workflowStageById } from "../workflow-stage.js";

export function FinalVideoStagePanel({ model, actions }) {
  const {
    cancellingWorkflow,
    finalVideo,
    finalVideoError,
    finalVideoStyle,
    isGeneratingFinalVideoPreview,
    isStartingFinalVideo,
    previewVersion,
    record,
    subtitleEditorCues,
  } = model;
  const {
    cancelWorkflow,
    generateFinalVideoPreview,
    runFinalVideo,
    setFinalVideo,
    setFinalVideoError,
    updateFinalVideoStyle,
    updateFinalVideoStyleValues,
  } = actions;

  return (
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
  );
}

