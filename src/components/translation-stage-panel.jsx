import { Fragment } from "react";
import { Plus } from "lucide-react";
import { DirectoryResult, FileResult } from "./artifact-results.jsx";
import { CancelTaskButton, WorkflowStageSection } from "./workflow-ui.jsx";
import { workflowStageById } from "../workflow-stage.js";

export function TranslationStagePanel({ model, actions }) {
  const {
    canTranslate,
    cancellingWorkflow,
    embedded,
    finalSubtitles,
    finalSubtitlesError,
    isImportingTranslationSrt,
    isSavingSubtitleEditor,
    isStartingFinalSubtitles,
    pendingEnglishNumbers,
    record,
    subtitleEditor,
    subtitleEditorComplete,
    subtitleEditorCues,
    subtitleEditorError,
    subtitleEditorMessage,
    translationPrompt,
    translationPromptVisible,
  } = model;
  const {
    applyRoleToMatchingCues,
    cancelWorkflow,
    copyTranslationPrompt,
    importTranslationSrt,
    insertSubtitleCueAfter,
    openPath,
    runFinalSubtitles,
    saveSubtitleEdits,
    setFinalSubtitles,
    setFinalSubtitlesError,
    setTranslationPromptText,
    setTranslationPromptVisible,
    updateSubtitleCue,
  } = actions;

  return (
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
                      <span>时间 / 中文字幕</span>
                      <span>角色</span>
                      <span>英文字幕</span>
                    </div>
                    {subtitleEditorCues.map((cue, index) => (
                      <Fragment key={cue.number}>
                        <div className="subtitle-editor-row" role="row">
                          <div className="subtitle-source">
                            <strong>{String(cue.number).padStart(3, "0")}</strong>
                            <div className="subtitle-time-fields">
                              <input
                                aria-label={`第 ${cue.number} 条开始时间`}
                                type="text"
                                value={cue.start}
                                onChange={(event) => updateSubtitleCue(cue.number, "start", event.target.value)}
                              />
                              <span>-</span>
                              <input
                                aria-label={`第 ${cue.number} 条结束时间`}
                                type="text"
                                value={cue.end}
                                onChange={(event) => updateSubtitleCue(cue.number, "end", event.target.value)}
                              />
                            </div>
                            <textarea
                              aria-label={`第 ${cue.number} 条中文字幕`}
                              rows={2}
                              value={cue.chinese}
                              onChange={(event) => updateSubtitleCue(cue.number, "chinese", event.target.value)}
                            />
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
                        {index < subtitleEditorCues.length - 1 && (
                          <div className="subtitle-insert-row">
                            <button
                              aria-label={`在第 ${cue.number} 条双语字幕后新增字幕`}
                              className="subtitle-insert-button"
                              title="新增字幕"
                              type="button"
                              onClick={() => insertSubtitleCueAfter(cue.number)}
                            >
                              <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </Fragment>
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
  );
}

