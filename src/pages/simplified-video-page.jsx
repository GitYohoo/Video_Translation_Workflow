import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { requestJson } from "../api.js";
import { artifactDisplayName } from "../path-display.js";
import {
  buildSimplifiedWorkflowOverview,
  hasAutomaticWorkflowProgress,
  nextAutomaticActions,
  summarizeAutomaticWorkflow,
} from "../simplified-workflow.js";
import { useVideoRecord, useWorkflowStatus } from "../use-video-data.js";
import { FileResult } from "../components/artifact-results.jsx";
import { ProjectWorkflowOverview } from "../components/workflow-ui.jsx";
import { formatSize } from "../format.js";
import {
  createInsertedChineseCueId,
  insertedCueTiming,
  withChineseCueEditorMetadata,
  withRenumberedCues,
  withUpdatedCueTime,
} from "../subtitle-editor-utils.js";
import { VideoPage } from "./video-page.jsx";

export function SimplifiedVideoPage({ videos, isLoading }) {
  const { videoId } = useParams();
  const videoRef = useRef(null);
  const inFlightActions = useRef(new Set());
  const { record, notFound, mutate: mutateRecord } = useVideoRecord(videoId, videos, isLoading);
  const separationResource = useWorkflowStatus(record?.id, "bs-roformer");
  const ocrResource = useWorkflowStatus(record?.id, "ocr-subtitles");
  const speakersResource = useWorkflowStatus(record?.id, "whisperx-speakers");
  const finalSubtitlesResource = useWorkflowStatus(record?.id, "final-subtitles");
  const translationResource = useWorkflowStatus(record?.id, "subtitle-editor");
  const englishDubbingResource = useWorkflowStatus(record?.id, "english-dubbing-mix");
  const finalVideoResource = useWorkflowStatus(record?.id, "final-video");
  const finalValidationResource = useWorkflowStatus(record?.id, "final-validation");
  const chineseSubtitleEditorResource = useWorkflowStatus(
    finalSubtitlesResource.status?.outputs?.srt?.ready ? record?.id : null,
    "chinese-subtitle-editor",
    { refreshWhenIdle: false, revalidateOnFocus: false },
  );
  const separation = separationResource.status;
  const ocr = ocrResource.status;
  const speakers = speakersResource.status;
  const finalSubtitles = finalSubtitlesResource.status;
  const translationStatus = translationResource.status;
  const downstreamEnglishDubbing = englishDubbingResource.status;
  const downstreamFinalVideo = finalVideoResource.status;
  const downstreamFinalValidation = finalValidationResource.status;
  const statusRequestError = [
    separationResource,
    ocrResource,
    speakersResource,
    finalSubtitlesResource,
    translationResource,
    englishDubbingResource,
    finalVideoResource,
    finalValidationResource,
  ].find((resource) => resource.error)?.errorMessage || "";
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
  const effectiveWorkflowStarted = workflowStarted || hasAutomaticWorkflowProgress({
    separation,
    ocr,
    speakers,
    finalSubtitles,
  });

  const refreshStatuses = useCallback(async () => {
    await Promise.all([
      separationResource.mutate(),
      ocrResource.mutate(),
      speakersResource.mutate(),
      finalSubtitlesResource.mutate(),
      translationResource.mutate(),
      englishDubbingResource.mutate(),
      finalVideoResource.mutate(),
      finalValidationResource.mutate(),
    ]);
  }, [
    separationResource.mutate,
    ocrResource.mutate,
    speakersResource.mutate,
    finalSubtitlesResource.mutate,
    translationResource.mutate,
    englishDubbingResource.mutate,
    finalVideoResource.mutate,
    finalValidationResource.mutate,
  ]);

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    setEditorCues([]);
    setEditorOriginalCues([]);
    setWorkflowStarted(false);
    setSelectedPanel("generateChinese");
    setWorkflowError("");
    setEditorError("");
    return undefined;
  }, [record?.id]);

  const runAutomaticAction = useCallback(async (action) => {
    if (!record || inFlightActions.current.has(action)) {
      return;
    }
    const configuration = {
      separation: ["bs-roformer", separationResource.mutate],
      ocr: ["ocr-subtitles", ocrResource.mutate],
      speakers: ["whisperx-speakers", speakersResource.mutate],
      finalSubtitles: ["final-subtitles", finalSubtitlesResource.mutate],
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
      await configuration[1](status, { revalidate: false });
    } catch (error) {
      setWorkflowError(error.message);
    } finally {
      inFlightActions.current.delete(action);
    }
  }, [
    record,
    separationResource.mutate,
    ocrResource.mutate,
    speakersResource.mutate,
    finalSubtitlesResource.mutate,
  ]);

  useEffect(() => {
    if (!record || !separation || !ocr || !speakers || !finalSubtitles) {
      return;
    }
    const actions = nextAutomaticActions({
      started: effectiveWorkflowStarted,
      storageMode: record.storageMode,
      separation,
      ocr,
      speakers,
      finalSubtitles,
    });
    actions.forEach((action) => void runAutomaticAction(action));
  }, [
    record,
    effectiveWorkflowStarted,
    separation,
    ocr,
    speakers,
    finalSubtitles,
    runAutomaticAction,
  ]);

  useEffect(() => {
    if (!record || !finalSubtitles?.outputs?.srt?.ready) {
      setEditorCues([]);
      setEditorOriginalCues([]);
      return undefined;
    }
    const result = chineseSubtitleEditorResource.status;
    if (result) {
      setEditorCues(withChineseCueEditorMetadata(result.cues || []));
      setEditorOriginalCues(result.cues || []);
    }
    setEditorError(chineseSubtitleEditorResource.errorMessage);
    return undefined;
  }, [
    record,
    finalSubtitles?.outputs?.srt?.ready,
    chineseSubtitleEditorResource.status,
    chineseSubtitleEditorResource.errorMessage,
  ]);

  const workflowSummary = summarizeAutomaticWorkflow({
    started: effectiveWorkflowStarted,
    separation,
    ocr,
    speakers,
    finalSubtitles,
  });
  const projectWorkflowRunning = [
    separation,
    ocr,
    speakers,
    finalSubtitles,
    downstreamEnglishDubbing,
    downstreamFinalVideo,
    downstreamFinalValidation,
  ].some((task) => task?.status === "running");
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
      (cue) => (cue.number === number ? withUpdatedCueTime(cue, field, value) : cue),
    ));
    setEditorMessage("");
  };

  const insertChineseCueAfter = (number) => {
    setEditorError("");
    setEditorMessage("");
    const editorId = createInsertedChineseCueId();
    setEditorCues((current) => {
      const index = current.findIndex((cue) => cue.number === number);
      if (index < 0) {
        return current;
      }
      const timing = insertedCueTiming(current, index);
      return withRenumberedCues([
        ...current.slice(0, index + 1),
        {
          number: number + 1,
          ...timing,
          editorId,
          sourceNumber: null,
          speaker: "",
          text: "",
        },
        ...current.slice(index + 1),
      ]);
    });
  };

  const deleteChineseCue = (number) => {
    setEditorError("");
    setEditorMessage(`已删除第 ${String(number).padStart(3, "0")} 条字幕，保存后生效。`);
    setEditorCues((current) => (
      current.length <= 1
        ? current
        : withRenumberedCues(current.filter((cue) => cue.number !== number))
    ));
  };

  const applySpeakerToMatchingCues = (number) => {
    const editedCue = editorCues.find((cue) => cue.number === number);
    const sourceCue = editorOriginalCues.find((cue) => cue.number === editedCue?.sourceNumber);
    if (!editedCue || !sourceCue) {
      return;
    }
    setEditorError("");
    setEditorCues((current) =>
      current.map((cue) => {
        const original = editorOriginalCues.find((savedCue) => savedCue.number === cue.sourceNumber);
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
          cues: editorCues.map(({ number, start, end, speaker, text }) => ({
            number,
            start,
            end,
            speaker,
            text,
          })),
        }),
      });
      setEditorCues(withChineseCueEditorMetadata(result.cues || []));
      setEditorOriginalCues(result.cues || []);
      await chineseSubtitleEditorResource.mutate(result, { revalidate: false });
      await finalSubtitlesResource.mutate(
        (current) => current && ({
          ...current,
          outputs: {
            ...current.outputs,
            srt: { ...current.outputs?.srt, revision: result.revision },
          },
        }),
        { revalidate: false },
      );
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
      await mutateRecord(updated, { revalidate: false });
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
  const displayedError = workflowError
    || statusRequestError
    || [separation, ocr, speakers, finalSubtitles].find((task) => task?.error)?.error;
  const simplifiedOverview = buildSimplifiedWorkflowOverview({
    started: effectiveWorkflowStarted,
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
            <button
              className="secondary-button compact"
              disabled={isReplacingSource || projectWorkflowRunning}
              title={projectWorkflowRunning ? "请先等待当前任务完成或取消任务" : undefined}
              type="button"
              onClick={replaceProjectSource}
            >
              {isReplacingSource ? "等待选择..." : "更换原视频"}
            </button>
            {!effectiveWorkflowStarted && finalSubtitles?.status !== "completed" && (
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
                    <p>点击编号可跳到对应画面，也可以直接修改时间和字幕正文。</p>
                  </div>
                  <button className="primary-button" disabled={isSaving || editorCues.length === 0} type="button" onClick={saveChineseSubtitles}>
                    {isSaving ? "正在保存..." : "保存中文字幕"}
                  </button>
                </div>
                {editorError && <p className="workflow-error">{editorError}</p>}
                {editorMessage && <p className="copy-status">{editorMessage}</p>}
                {editorCues.length === 0 && !editorError && <p className="copy-status">正在读取最终中文字幕...</p>}
                <div className="chinese-cue-list">
                  {editorCues.map((cue, index) => (
                    <Fragment key={cue.editorId}>
                      <article className={`chinese-cue-row ${activeCueNumber === cue.number ? "active" : ""}`}>
                        <div className="cue-time-field">
                          <div className="cue-row-toolbar">
                            <button className="cue-number-button" type="button" onClick={() => seekToCue(cue)}>
                              {String(cue.number).padStart(3, "0")}
                            </button>
                            <button
                              aria-label={`删除第 ${cue.number} 条中文字幕`}
                              className="danger-button cue-delete-button"
                              disabled={editorCues.length <= 1}
                              title={editorCues.length <= 1 ? "至少保留一条字幕" : "删除当前字幕"}
                              type="button"
                              onClick={() => deleteChineseCue(cue.number)}
                            >
                              <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                              删除当前字幕
                            </button>
                          </div>
                          <div className="subtitle-time-fields">
                            <input
                              aria-label={`第 ${cue.number} 条中文字幕开始时间`}
                              type="text"
                              value={cue.start}
                              onChange={(event) => updateCueField(cue.number, "start", event.target.value)}
                            />
                            <span>-</span>
                            <input
                              aria-label={`第 ${cue.number} 条中文字幕结束时间`}
                              type="text"
                              value={cue.end}
                              onChange={(event) => updateCueField(cue.number, "end", event.target.value)}
                            />
                          </div>
                        </div>
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
                      {index < editorCues.length - 1 && (
                        <div className="subtitle-insert-row">
                          <button
                            aria-label={`在第 ${cue.number} 条中文字幕后新增字幕`}
                            className="subtitle-insert-button"
                            title="新增字幕"
                            type="button"
                            onClick={() => insertChineseCueAfter(cue.number)}
                          >
                            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </Fragment>
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

