import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { requestJson } from "../api.js";
import { artifactDisplayName, pathLeafName } from "../path-display.js";
import { clampSubtitleFontSize, clampSubtitlePosition } from "../final-video-style.js";
import { buildWorkflowOverview } from "../workflow-summary.js";
import { useVideoRecord, useWorkflowStatus } from "../use-video-data.js";
import { AssetStagesPanel } from "../components/asset-stages-panel.jsx";
import { EnglishDubbingStagePanel } from "../components/english-dubbing-stage-panel.jsx";
import { FinalValidationStagePanel } from "../components/final-validation-stage-panel.jsx";
import { FinalVideoStagePanel } from "../components/final-video-stage-panel.jsx";
import { TranslationStagePanel } from "../components/translation-stage-panel.jsx";
import { VideoProjectHeader } from "../components/video-project-header.jsx";
import { dubbingSegmentDraftFrom } from "../dubbing-utils.js";
import {
  buildTranslationPrompt,
  insertedCueTiming,
  mergeTimelineRanges,
  withRenumberedCues,
  withUpdatedCueTime,
} from "../subtitle-editor-utils.js";

const defaultFinalVideoStyle = {
  fontName: "Segoe UI Semibold",
  fontSize: 50,
  textColor: "#FFFFFF",
  backgroundColor: "#101010",
  backgroundOpacity: 1,
  positionX: 50,
  positionY: 84,
};
export function VideoPage({ videos, isLoading, embedded = false, visiblePanel = null }) {
  const { videoId } = useParams();
  const finalValidationVideoRef = useRef(null);
  const validationResumeTimeRef = useRef(null);
  const finalVideoStyleInitializationRef = useRef("");
  const previousFinalValidationStatusRef = useRef(null);
  const { record, notFound, mutate: mutateRecord } = useVideoRecord(videoId, videos, isLoading);
  const separationResource = useWorkflowStatus(record?.id, "bs-roformer");
  const ocrResource = useWorkflowStatus(record?.id, "ocr-subtitles");
  const speakersResource = useWorkflowStatus(record?.id, "whisperx-speakers");
  const finalSubtitlesResource = useWorkflowStatus(record?.id, "final-subtitles");
  const englishDubbingResource = useWorkflowStatus(record?.id, "english-dubbing-mix");
  const finalVideoResource = useWorkflowStatus(record?.id, "final-video");
  const finalValidationResource = useWorkflowStatus(record?.id, "final-validation");
  const subtitleEditorRevision = finalSubtitlesResource.status?.outputs?.srt?.ready
    ? finalSubtitlesResource.status.outputs.srt.revision
      || finalSubtitlesResource.status.finishedAt
      || finalSubtitlesResource.status.outputs.srt.path
      || "ready"
    : "";
  const subtitleEditorResource = useWorkflowStatus(
    finalSubtitlesResource.status?.outputs?.srt?.ready ? record?.id : null,
    "subtitle-editor",
    {
      refreshWhenIdle: false,
      revalidateOnFocus: false,
      revalidateOnMount: true,
      revision: subtitleEditorRevision,
    },
  );
  const separation = separationResource.status;
  const setSeparation = separationResource.setStatus;
  const ocr = ocrResource.status;
  const setOcr = ocrResource.setStatus;
  const speakers = speakersResource.status;
  const setSpeakers = speakersResource.setStatus;
  const finalSubtitles = finalSubtitlesResource.status;
  const setFinalSubtitles = finalSubtitlesResource.setStatus;
  const subtitleEditor = subtitleEditorResource.status;
  const setSubtitleEditor = subtitleEditorResource.setStatus;
  const englishDubbing = englishDubbingResource.status;
  const setEnglishDubbing = englishDubbingResource.setStatus;
  const finalVideo = finalVideoResource.status;
  const setFinalVideo = finalVideoResource.setStatus;
  const finalValidation = finalValidationResource.status;
  const setFinalValidation = finalValidationResource.setStatus;
  const [isReplacingSource, setIsReplacingSource] = useState(false);
  const [sourceReplaceMessage, setSourceReplaceMessage] = useState("");
  const [cancellingWorkflow, setCancellingWorkflow] = useState("");
  const [separationActionError, setSeparationError] = useState("");
  const separationError = separationActionError || separationResource.errorMessage;
  const [isStartingSeparation, setIsStartingSeparation] = useState(false);
  const [ocrActionError, setOcrError] = useState("");
  const ocrError = ocrActionError || ocrResource.errorMessage;
  const [isStartingOcr, setIsStartingOcr] = useState(false);
  const [speakersActionError, setSpeakersError] = useState("");
  const speakersError = speakersActionError || speakersResource.errorMessage;
  const [isStartingSpeakers, setIsStartingSpeakers] = useState(false);
  const [finalSubtitlesActionError, setFinalSubtitlesError] = useState("");
  const finalSubtitlesError =
    finalSubtitlesActionError || finalSubtitlesResource.errorMessage;
  const [isStartingFinalSubtitles, setIsStartingFinalSubtitles] = useState(false);
  const [subtitleEditorCues, setSubtitleEditorCues] = useState([]);
  const [subtitleEditorOriginalCues, setSubtitleEditorOriginalCues] = useState(
    subtitleEditorCues,
  );
  const subtitleEditorDirty = subtitleEditorCues !== subtitleEditorOriginalCues;
  const [subtitleEditorActionError, setSubtitleEditorError] = useState("");
  const subtitleEditorError =
    subtitleEditorActionError || subtitleEditorResource.errorMessage;
  const [subtitleEditorMessage, setSubtitleEditorMessage] = useState("");
  const [translationPromptVisible, setTranslationPromptVisible] = useState(false);
  const [translationPromptText, setTranslationPromptText] = useState("");
  const [isImportingTranslationSrt, setIsImportingTranslationSrt] = useState(false);
  const [isSavingSubtitleEditor, setIsSavingSubtitleEditor] = useState(false);
  const [englishDubbingActionError, setEnglishDubbingError] = useState("");
  const englishDubbingError =
    englishDubbingActionError || englishDubbingResource.errorMessage;
  const [isStartingEnglishDubbing, setIsStartingEnglishDubbing] = useState(false);
  const [selectedDubbingSegmentNumber, setSelectedDubbingSegmentNumber] = useState(null);
  const [dubbingSegmentDraft, setDubbingSegmentDraft] = useState(null);
  const [dubbingSegmentMessage, setDubbingSegmentMessage] = useState("");
  const [isRegeneratingDubbingSegment, setIsRegeneratingDubbingSegment] = useState(false);
  const [finalVideoStyle, setFinalVideoStyle] = useState(defaultFinalVideoStyle);
  const [finalVideoActionError, setFinalVideoError] = useState("");
  const finalVideoError = finalVideoActionError || finalVideoResource.errorMessage;
  const [isGeneratingFinalVideoPreview, setIsGeneratingFinalVideoPreview] = useState(false);
  const [isStartingFinalVideo, setIsStartingFinalVideo] = useState(false);
  const [finalValidationActionError, setFinalValidationError] = useState("");
  const finalValidationError =
    finalValidationActionError || finalValidationResource.errorMessage;
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

  useEffect(() => {
    if (!record) {
      return undefined;
    }
    setFinalVideoStyle(defaultFinalVideoStyle);
    setSeparationError("");
    setSourceReplaceMessage("");
    setCancellingWorkflow("");
    setOcrError("");
    setSpeakersError("");
    setFinalSubtitlesError("");
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
    finalVideoStyleInitializationRef.current = "";
    previousFinalValidationStatusRef.current = null;
    return undefined;
  }, [record?.id]);

  useEffect(() => {
    const emptyCues = [];
    setSubtitleEditorCues(emptyCues);
    setSubtitleEditorOriginalCues(emptyCues);
  }, [record?.id, subtitleEditorRevision]);

  useEffect(() => {
    if (
      !record
      || !finalSubtitles?.outputs?.srt?.ready
      || !subtitleEditor
      || subtitleEditorResource.isValidating
      || subtitleEditorResource.error
      || subtitleEditorDirty
    ) {
      return undefined;
    }
    const remoteCues = subtitleEditor.cues || [];
    setSubtitleEditorCues(remoteCues);
    setSubtitleEditorOriginalCues(remoteCues);
    setTranslationPromptText(
      buildTranslationPrompt(
        finalSubtitles.outputs.srt.path,
        finalSubtitles.translationTarget.jsonPath,
      ),
    );
    return undefined;
  }, [
    record?.id,
    finalSubtitles?.outputs?.srt?.ready,
    finalSubtitles?.outputs?.srt?.path,
    finalSubtitles?.translationTarget?.jsonPath,
    subtitleEditor,
    subtitleEditorResource.error,
    subtitleEditorResource.isValidating,
    subtitleEditorDirty,
  ]);

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
    if (!record || !finalVideo) {
      return undefined;
    }
    if (finalVideoStyleInitializationRef.current === record.id) {
      return undefined;
    }
    finalVideoStyleInitializationRef.current = record.id;
    setFinalVideoStyle(finalVideo.style || defaultFinalVideoStyle);
    return undefined;
  }, [record, finalVideo]);

  useEffect(() => {
    if (!finalValidation) {
      return undefined;
    }
    setSourceAudioRanges(finalValidation.configuration?.sourceAudioRanges || []);
    setMutedBackgroundRanges(finalValidation.configuration?.mutedBackgroundRanges || []);
    if (
      finalValidation.status === "completed" &&
      previousFinalValidationStatusRef.current === "running"
    ) {
      setValidationVideoVersion(Date.now());
    }
    previousFinalValidationStatusRef.current = finalValidation.status;
    return undefined;
  }, [finalValidation]);

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
        return withUpdatedCueTime(cue, field, value);
      }),
    );
  };

  const insertSubtitleCueAfter = (number) => {
    setSubtitleEditorMessage("");
    setSubtitleEditorError("");
    setSubtitleEditorCues((cues) => {
      const index = cues.findIndex((cue) => cue.number === number);
      if (index < 0) {
        return cues;
      }
      const timing = insertedCueTiming(cues, index);
      return withRenumberedCues([
        ...cues.slice(0, index + 1),
        {
          number: number + 1,
          ...timing,
          role: "",
          chinese: "",
          english: "",
          skipped: true,
        },
        ...cues.slice(index + 1),
      ]);
    });
  };

  const applyRoleToMatchingCues = (number) => {
    const editedCue = subtitleEditorCues.find((cue) => cue.number === number);
    const sourceCue = subtitleEditorOriginalCues.find((cue) => cue.number === number);
    if (!editedCue || !sourceCue) {
      return;
    }
    setSubtitleEditorError("");
    setSubtitleEditorCues((cues) =>
      cues.map((cue) => {
        const original = subtitleEditorOriginalCues.find(
          (savedCue) => savedCue.number === cue.number,
        );
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
      await finalSubtitlesResource.mutate();
      const result = await requestJson(`/api/videos/${record.id}/workflow/subtitle-editor/import-srt`, {
        method: "POST",
      });
      await setSubtitleEditor(result);
      setSubtitleEditorCues(result.cues);
      setSubtitleEditorOriginalCues(result.cues);
      setSubtitleEditorMessage(
        `已解析英文字幕文件：导入 ${result.completedEnglishCount} 条，跳过 ${result.skippedEnglishCount} 条。请校对后保存。`,
      );
      await Promise.all([
        finalSubtitlesResource.mutate(),
        englishDubbingResource.mutate(),
        finalVideoResource.mutate(),
      ]);
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
          cues: subtitleEditorCues.map(({ number, start, end, role, chinese, english, skipped }) => ({
            number,
            start,
            end,
            role,
            chinese,
            english,
            skipped,
          })),
        }),
      });
      await setSubtitleEditor(result);
      setSubtitleEditorCues(result.cues);
      setSubtitleEditorOriginalCues(result.cues);
      const remainingEnglishCount = result.cues.filter((cue) => !cue.english.trim() && !cue.skipped).length;
      setSubtitleEditorMessage(
        result.complete
          ? "角色与英文字幕已保存。配音阶段将基于这些内容生成受控英文字幕。"
          : remainingEnglishCount > 0
            ? `编辑进度已保存，仍有 ${remainingEnglishCount} 条英文待填写。`
            : "编辑进度已保存，留空条目已视为跳过。",
      );
      await Promise.all([
        finalSubtitlesResource.mutate(),
        englishDubbingResource.mutate(),
        finalVideoResource.mutate(),
      ]);
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
  }, [record?.id]);

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
      await mutateRecord(updated, { revalidate: false });
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
  const projectWorkflowRunning = [
    separation,
    ocr,
    speakers,
    finalSubtitles,
    englishDubbing,
    finalVideo,
    finalValidation,
  ].some((task) => task?.status === "running");
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
        <VideoProjectHeader
          model={{
            isReplacingSource,
            overviewActionDisabledById,
            projectWorkflowRunning,
            record,
            sourceDisplayName,
            sourceReplaceMessage,
            workflowOverview,
          }}
          actions={{
            replaceProjectSource,
            runOverviewNext,
            scrollToWorkflowStep,
          }}
        />
      )}
      {openPathError && <p className="workflow-error page-error">{openPathError}</p>}
      <section className="project-content">
        {!embedded && (
          <AssetStagesPanel
            model={{
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
            }}
            actions={{
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
            }}
          />
        )}
        {(!embedded || visiblePanel === "translation") && (
          <TranslationStagePanel
            model={{
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
            }}
            actions={{
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
            }}
          />
        )}
        {(!embedded || visiblePanel === "englishDubbing") && (
          <EnglishDubbingStagePanel
            model={{
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
            }}
            actions={{
              cancelWorkflow,
              chooseDubbingReferenceAudio,
              regenerateDubbingSegment,
              runEnglishDubbing,
              setDubbingSegmentDraft,
              setDubbingSegmentMessage,
              setEnglishDubbing,
              setEnglishDubbingError,
              setSelectedDubbingSegmentNumber,
            }}
          />
        )}
        {(!embedded || visiblePanel === "finalVideo") && (
          <FinalVideoStagePanel
            model={{
              cancellingWorkflow,
              finalVideo,
              finalVideoError,
              finalVideoStyle,
              isGeneratingFinalVideoPreview,
              isStartingFinalVideo,
              previewVersion,
              record,
              subtitleEditorCues,
            }}
            actions={{
              cancelWorkflow,
              generateFinalVideoPreview,
              runFinalVideo,
              setFinalVideo,
              setFinalVideoError,
              updateFinalVideoStyle,
              updateFinalVideoStyleValues,
            }}
          />
        )}
        {(!embedded || visiblePanel === "finalValidation") && (
          <FinalValidationStagePanel
            model={{
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
            }}
            actions={{
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
            }}
          />
        )}
        
      </section>
    </PageContainer>
  );
}

