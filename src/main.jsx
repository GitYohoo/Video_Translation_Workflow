import { StrictMode, useCallback, useEffect, useState } from "react";
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
import "./styles.css";

const defaultFinalVideoStyle = {
  fontName: "Segoe UI Semibold",
  fontSize: 50,
  textColor: "#FFFFFF",
  backgroundColor: "#101010",
  backgroundOpacity: 1,
  bottomMargin: 148,
};

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

function FileResult({ label, file, onOpen, readyText = "已生成", missingText = "未生成" }) {
  const ready = Boolean(file?.ready);
  return (
    <div className={ready ? "ready" : ""}>
      <div className="result-heading">
        <strong>{label}</strong>
        <span className="result-actions">
          <small>{ready ? readyText : missingText}</small>
          {ready && (
            <button className="open-path-button" type="button" onClick={() => onOpen(file.path)}>
              打开
            </button>
          )}
        </span>
      </div>
      <code className={ready ? "" : "empty-path"}>{ready ? file.path : "未生成"}</code>
    </div>
  );
}

function DirectoryResult({ label, path, ready, onOpen }) {
  return (
    <div className="output-root">
      <div className="result-heading">
        <span>{label}</span>
        {ready && (
          <button className="open-path-button" type="button" onClick={() => onOpen(path)}>
            打开
          </button>
        )}
      </div>
      <code className={ready ? "" : "empty-path"}>{ready ? path : "未生成"}</code>
    </div>
  );
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

function Sidebar({ videos, isLoading, isSaving, onAddPath, onDelete }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">VT</span>
        <span className="brand-label">翻译工作流</span>
      </div>
      <button
        className="upload-button"
        disabled={isSaving}
        type="button"
        onClick={onAddPath}
      >
        <span aria-hidden="true">+</span>
        <strong>{isSaving ? "正在记录..." : "添加原视频"}</strong>
      </button>
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
              onClick={() => onDelete(video.id)}
            >
              &times;
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function WelcomePage({ isSaving, onAddPath }) {
  return (
    <main className="welcome-page">
      <section className="welcome-panel">
        <p className="eyebrow">Video Translation Workflow</p>
        <h1>视频翻译工作台</h1>
        <p className="welcome-copy">
          选择本机原视频并记录路径，不复制视频文件。每个视频都会成为独立工作项目。
        </p>
        <button className="primary-button" disabled={isSaving} type="button" onClick={onAddPath}>
          <span>+</span> {isSaving ? "正在记录..." : "添加原视频路径"}
        </button>
      </section>
    </main>
  );
}

function PathDialog({ isSaving, value, onChange, onClose, onSubmit }) {
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
        <h2 id="path-dialog-title">记录原视频路径</h2>
        <p className="dialog-copy">
          输入或粘贴原视频的完整路径。应用只登记该路径，不会复制视频文件。
        </p>
        <label className="path-label" htmlFor="source-path">
          原视频绝对路径
        </label>
        <input
          autoFocus
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
        <p className="path-hint">可在资源管理器中按住 Shift 右键文件，选择“复制为路径”。</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button compact"
            disabled={isSaving || !value.trim()}
            type="button"
            onClick={onSubmit}
          >
            {isSaving ? "正在记录..." : "建立项目"}
          </button>
        </div>
      </section>
    </div>
  );
}

function VideoPage({ videos, isLoading }) {
  const { videoId } = useParams();
  const [record, setRecord] = useState(null);
  const [notFound, setNotFound] = useState(false);
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
  const [bulkEnglishText, setBulkEnglishText] = useState("");
  const [isSavingSubtitleEditor, setIsSavingSubtitleEditor] = useState(false);
  const [englishDubbing, setEnglishDubbing] = useState(null);
  const [englishDubbingError, setEnglishDubbingError] = useState("");
  const [isStartingEnglishDubbing, setIsStartingEnglishDubbing] = useState(false);
  const [finalVideo, setFinalVideo] = useState(null);
  const [finalVideoStyle, setFinalVideoStyle] = useState(defaultFinalVideoStyle);
  const [finalVideoError, setFinalVideoError] = useState("");
  const [isGeneratingFinalVideoPreview, setIsGeneratingFinalVideoPreview] = useState(false);
  const [isStartingFinalVideo, setIsStartingFinalVideo] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [openPathError, setOpenPathError] = useState("");

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
    setFinalVideoStyle(defaultFinalVideoStyle);
    setSeparationError("");
    setOcrError("");
    setSpeakersError("");
    setFinalSubtitlesError("");
    setSubtitleEditor(null);
    setSubtitleEditorCues([]);
    setSubtitleEditorError("");
    setSubtitleEditorMessage("");
    setBulkEnglishText("");
    setEnglishDubbingError("");
    setFinalVideoError("");
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
    let active = true;
    requestJson(`/api/videos/${record.id}/workflow/final-subtitles`)
      .then((result) => {
        if (active) {
          setFinalSubtitles(result);
        }
      })
      .catch((error) => {
        if (active) {
          setFinalSubtitlesError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [
    record,
    ocr?.outputs?.srt?.ready,
    speakers?.outputs?.srt?.ready,
  ]);

  useEffect(() => {
    if (!record || finalSubtitles?.status !== "running") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      requestJson(`/api/videos/${record.id}/workflow/final-subtitles`)
        .then((result) => setFinalSubtitles(result))
        .catch((error) => setFinalSubtitlesError(error.message));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [record, finalSubtitles?.status]);

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
  }, [record, englishDubbing?.outputs?.mixedTrack?.ready]);

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
    subtitleEditorCues.every((cue) => cue.english.trim());

  const updateSubtitleCue = (number, field, value) => {
    setSubtitleEditorMessage("");
    setSubtitleEditorError("");
    setSubtitleEditorCues((cues) =>
      cues.map((cue) => (cue.number === number ? { ...cue, [field]: value } : cue)),
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

  const applyBulkEnglishText = () => {
    const lines = bulkEnglishText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length !== subtitleEditorCues.length) {
      setSubtitleEditorError(`批量英文需要 ${subtitleEditorCues.length} 行，当前检测到 ${lines.length} 行。`);
      return;
    }
    setSubtitleEditorCues((cues) =>
      cues.map((cue, index) => ({ ...cue, english: lines[index] })),
    );
    setSubtitleEditorError("");
    setSubtitleEditorMessage(`已导入 ${lines.length} 条英文正文，请检查角色和语气后保存。`);
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
          cues: subtitleEditorCues.map(({ number, role, english }) => ({
            number,
            role,
            english,
          })),
        }),
      });
      setSubtitleEditor(result);
      setSubtitleEditorCues(result.cues);
      setSubtitleEditorMessage(
        result.complete
          ? "角色与英文字幕已保存。配音阶段将基于这些内容生成受控英文字幕。"
          : `编辑进度已保存，仍有 ${result.cues.length - result.completedEnglishCount} 条英文待填写。`,
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

  const updateFinalVideoStyle = (field, value) => {
    setFinalVideoStyle((style) => ({ ...style, [field]: value }));
  };

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

  const openPath = async (targetPath) => {
    setOpenPathError("");
    try {
      await requestJson(`/api/videos/${record.id}/open-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath }),
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

  return (
    <main className="detail-page">
      <header className="detail-header">
        <div>
          <p className="eyebrow">视频项目</p>
          <h1>{record.name}</h1>
          <p className="file-meta">
            {formatSize(record.size)} · {record.type || "视频文件"} ·
            {record.storageMode === "reference" ? " 原路径引用" : " 旧版复制记录"}
          </p>
          <p className={`project-path ${record.sourcePath ? "" : "warning"}`}>
            {record.sourcePath || "未记录原视频路径，请重新添加原视频以执行工作流。"}
          </p>
        </div>
        <span className={`phase-tag ${record.storageMode === "reference" ? "" : "warning"}`}>
          {record.storageMode === "reference" ? "原路径已记录" : "待重新选择原视频"}
        </span>
      </header>
      {openPathError && <p className="workflow-error page-error">{openPathError}</p>}
      <section className="project-content">
        <div className="workflow-card">
          <p className="eyebrow">步骤 01</p>
          <h2>BS-RoFormer 二轨分离</h2>
          <p>从原视频生成 DX 对白轨与 MX+FX 背景轨，为后续字幕与配音阶段提供素材。</p>
          <div className={`step-status ${separation?.status || "ready"}`}>
            <strong>
              {separation?.status === "running" && "正在处理"}
              {separation?.status === "completed" && "已生成二轨"}
              {separation?.status === "failed" && "处理失败"}
              {separation?.status === "unavailable" && "不可执行"}
              {(!separation || separation.status === "ready") && "等待开始"}
            </strong>
            <small>
              {separation?.status === "running"
                ? "音轨分离正在后台执行，页面会自动刷新状态。"
                : "输出将写入原视频同级目录。"}
            </small>
          </div>
          <DirectoryResult
            label="输出目录"
            path={separation?.outputDirectory}
            ready={separation?.outputDirectoryReady}
            onOpen={openPath}
          />
          {separation?.outputs && (
            <div className="track-results">
              <FileResult label="DX 对白轨" file={separation.outputs.dialogue} onOpen={openPath} />
              <FileResult label="MX+FX 背景轨" file={separation.outputs.background} onOpen={openPath} />
            </div>
          )}
          {separationError && <p className="workflow-error">{separationError}</p>}
          {separation?.error && <p className="workflow-error">{separation.error}</p>}
          <button
            className="primary-button workflow-action"
            disabled={
              isStartingSeparation ||
              separation?.status === "running" ||
              record.storageMode !== "reference"
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
        </div>
        <div className="workflow-card">
          <p className="eyebrow">步骤 02</p>
          <h2>GPU OCR + FunASR 标点恢复</h2>
          <p>从视频画面的硬字幕提取中文字幕，并恢复标点，生成可用于后续处理的 OCR 字幕。</p>
          <div className={`step-status ${ocr?.status || "ready"}`}>
            <strong>
              {ocr?.status === "running" &&
                (ocr.stage === "punctuation" ? "正在恢复标点" : "正在提取字幕")}
              {ocr?.status === "completed" && "OCR 字幕已生成"}
              {ocr?.status === "failed" && "处理失败"}
              {ocr?.status === "unavailable" && "不可执行"}
              {(!ocr || ocr.status === "ready") && "等待开始"}
            </strong>
            <small>
              {ocr?.status === "running"
                ? ocr.stage === "punctuation"
                  ? "GPU OCR 已完成，正在执行 FunASR 标点恢复。"
                  : "GPU OCR 正在读取画面字幕，页面会自动刷新状态。"
                : "字幕结果将写入原视频同级目录。"}
            </small>
          </div>
          <DirectoryResult
            label="输出目录"
            path={ocr?.outputDirectory}
            ready={ocr?.outputDirectoryReady}
            onOpen={openPath}
          />
          {ocr?.outputs && (
            <div className="track-results">
              <FileResult label="OCR 字幕 SRT" file={ocr.outputs.srt} onOpen={openPath} />
              <FileResult label="OCR 质量报告" file={ocr.outputs.report} onOpen={openPath} />
            </div>
          )}
          {ocrError && <p className="workflow-error">{ocrError}</p>}
          {ocr?.error && <p className="workflow-error">{ocr.error}</p>}
          <button
            className="primary-button workflow-action"
            disabled={
              isStartingOcr ||
              ocr?.status === "running" ||
              record.storageMode !== "reference"
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
        </div>
        <div className="workflow-card">
          <p className="eyebrow">步骤 03</p>
          <h2>WhisperX 候选说话人</h2>
          <p>读取 DX 对白轨进行中文转写、时间对齐和候选说话人区分，为字幕角色归属提供参考。</p>
          <div className={`step-status ${speakers?.status || "blocked"}`}>
            <strong>
              {speakers?.status === "running" && "正在提取候选说话人"}
              {speakers?.status === "completed" && "候选说话人字幕已生成"}
              {speakers?.status === "failed" && "处理失败"}
              {speakers?.status === "unavailable" && "不可执行"}
              {(!speakers || speakers.status === "blocked") && "等待 DX 对白轨"}
              {speakers?.status === "ready" && "可以开始"}
            </strong>
            <small>
              {speakers?.status === "running"
                ? "WhisperX 正在后台执行，页面会自动刷新状态。"
                : speakers?.canRun
                  ? "已检测到 DX 对白轨，可以执行 WhisperX。"
                  : "请先完成步骤 01，生成 DX 对白轨。"}
            </small>
          </div>
          <div className="track-results input-results">
            <FileResult
              label="输入音轨"
              file={{ path: speakers?.inputPath, ready: speakers?.canRun }}
              onOpen={openPath}
              readyText="已就绪"
            />
          </div>
          <DirectoryResult
            label="输出目录"
            path={speakers?.outputDirectory}
            ready={speakers?.outputDirectoryReady}
            onOpen={openPath}
          />
          {speakers?.outputs && (
            <div className="track-results">
              <FileResult label="Speaker_Diarization SRT" file={speakers.outputs.srt} onOpen={openPath} />
              <FileResult label="Speaker_Diarization JSON" file={speakers.outputs.json} onOpen={openPath} />
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
        </div>
        <div className="workflow-card">
          <p className="eyebrow">步骤 04</p>
          <h2>合并最终中文字幕</h2>
          <p>将 OCR 标点字幕作为正文，合并 WhisperX 候选说话人标记，生成完整中文字幕文件。</p>
          <div className={`step-status ${finalSubtitles?.status || "blocked"}`}>
            <strong>
              {finalSubtitles?.status === "running" && "正在合并字幕"}
              {finalSubtitles?.status === "completed" && "最终中文字幕已生成"}
              {finalSubtitles?.status === "failed" && "合并失败"}
              {finalSubtitles?.status === "unavailable" && "不可执行"}
              {(!finalSubtitles || finalSubtitles.status === "blocked") && "等待合并输入"}
              {finalSubtitles?.status === "ready" && "可以开始"}
            </strong>
            <small>
              {finalSubtitles?.status === "running"
                ? "正在将 OCR 字幕与候选说话人字幕合并。"
                : finalSubtitles?.canRun
                  ? "两项 SRT 输入文件已齐全，可以生成完整中文字幕。"
                  : "需先生成 WhisperX SRT 与 OCR 标点修复 SRT。"}
            </small>
          </div>
          {finalSubtitles?.inputs && (
            <div className="track-results input-results">
              <FileResult label="WhisperX SRT" file={finalSubtitles.inputs.speakerSrt} onOpen={openPath} readyText="已就绪" />
              <FileResult label="OCR 标点修复 SRT" file={finalSubtitles.inputs.ocrSrt} onOpen={openPath} readyText="已就绪" />
            </div>
          )}
          <DirectoryResult
            label="输出目录"
            path={finalSubtitles?.outputDirectory}
            ready={finalSubtitles?.outputDirectoryReady}
            onOpen={openPath}
          />
          {finalSubtitles?.outputs && (
            <div className="track-results">
              <FileResult label="最终中文字幕 SRT" file={finalSubtitles.outputs.srt} onOpen={openPath} />
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
        </div>
        <div className="workflow-card manual-step">
          <p className="eyebrow">步骤 05</p>
          <h2>角色校对与英文翻译</h2>
          <p>直接在页面内校对角色并填写英文正文。时间轴固定来自最终中文字幕，保存操作不会修改起止时间。</p>
          <div className={`step-status ${canTranslate ? "ready" : "blocked"}`}>
            <strong>{canTranslate ? "可以编辑字幕" : "等待最终中文字幕"}</strong>
            <small>
              {canTranslate
                ? subtitleEditorComplete
                  ? "所有英文条目已填写，保存后可进入英文配音。"
                  : "先校对角色并补全每条英文字幕，保存后再进入英文配音。"
                : "请先完成步骤 04，生成最终中文字幕 SRT。"}
            </small>
          </div>
          {canTranslate && subtitleEditor?.canEdit && (
            <>
              <div className="subtitle-editor-summary">
                <strong>{subtitleEditorCues.length} 条字幕</strong>
                <span>已填写英文 {subtitleEditorCues.filter((cue) => cue.english.trim()).length} 条</span>
                <span>时间码只读</span>
              </div>
              {subtitleEditor.draftError && <p className="workflow-error">{subtitleEditor.draftError}</p>}
              <section className="bulk-translation-panel" aria-label="批量导入英文正文">
                <label htmlFor="bulk-english-text">批量粘贴英文正文</label>
                <p>每行对应一条中文字幕，适合将外部翻译结果一次性贴入；也可直接在下方逐句编辑。</p>
                <textarea
                  id="bulk-english-text"
                  rows={4}
                  value={bulkEnglishText}
                  placeholder={`粘贴 ${subtitleEditorCues.length} 行英文正文`}
                  onChange={(event) => setBulkEnglishText(event.target.value)}
                />
                <button className="secondary-button compact" type="button" onClick={applyBulkEnglishText}>
                  按行导入英文
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
                  label="英文字幕译稿 SRT"
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
        <div className="workflow-card manual-step">
          <p className="eyebrow">步骤 06</p>
          <h2>IndexTTS2 英文配音与混音</h2>
          <p>先将英文译稿同步到主时间轴并预检，再仅更新受影响配音片段，最后与 MX+FX 背景底轨混音。</p>
          <div className={`step-status ${englishDubbing?.status || "blocked"}`}>
            <strong>
              {englishDubbing?.status === "running" &&
                englishDubbing.stage === "preflight" &&
                "正在预检英文字幕"}
              {englishDubbing?.status === "running" &&
                englishDubbing.stage === "segments" &&
                "正在切割 DX 对白轨"}
              {englishDubbing?.status === "running" &&
                englishDubbing.stage === "assets" &&
                "正在准备 IndexTTS2 资源"}
              {englishDubbing?.status === "running" &&
                englishDubbing.stage === "dubbing" &&
                "正在生成英文配音"}
              {englishDubbing?.status === "running" &&
                englishDubbing.stage === "mixing" &&
                "正在合成英文混音"}
              {englishDubbing?.status === "completed" && "英文成片混音已生成"}
              {englishDubbing?.status === "failed" && "处理失败"}
              {englishDubbing?.status === "unavailable" && "不可执行"}
              {(!englishDubbing || englishDubbing.status === "blocked") && "等待英文字幕与音轨"}
              {englishDubbing?.status === "ready" && "可以开始"}
            </strong>
            <small>
              {englishDubbing?.status === "running"
                ? "任务包含字幕预检、分段切割、增量配音和整轨混音，页面会自动刷新状态。"
                : englishDubbing?.canRun
                  ? englishDubbing?.mixOutdated
                    ? "译稿或素材已变化，需要重新生成英文混音。"
                    : "英文译稿、主时间轴与所需音轨已齐全。"
                  : englishDubbing?.editorComplete === false
                    ? "请先在步骤 05 补全并保存英文字幕。"
                    : "需存在英文字幕译稿、最终中文字幕、DX 对白轨与 MX+FX 背景底轨。"}
            </small>
          </div>
          {englishDubbing?.inputs && (
            <div className="track-results input-results">
              <FileResult label="最终中文字幕（主时间轴）" file={englishDubbing.inputs.chineseTimelineSrt} onOpen={openPath} readyText="已就绪" />
              <FileResult label="英文字幕译稿" file={englishDubbing.inputs.englishDraftSrt} onOpen={openPath} readyText="已就绪" />
              <FileResult label="DX 对白轨" file={englishDubbing.inputs.dialogue} onOpen={openPath} readyText="已就绪" />
              <FileResult label="MX+FX 背景底轨" file={englishDubbing.inputs.background} onOpen={openPath} readyText="已就绪" />
            </div>
          )}
          <DirectoryResult
            label="工作目录"
            path={englishDubbing?.workDirectory}
            ready={englishDubbing?.workDirectoryReady}
            onOpen={openPath}
          />
          {englishDubbing?.outputs && (
            <div className="track-results">
              <FileResult label="受控英文字幕 SRT" file={englishDubbing.outputs.controlledEnglishSrt} onOpen={openPath} />
              <FileResult label="英文字幕预检报告" file={englishDubbing.outputs.preflightReport} onOpen={openPath} />
              <FileResult label="英文配音分段清单" file={englishDubbing.outputs.segmentManifest} onOpen={openPath} />
              <FileResult label="英文对白整轨" file={englishDubbing.outputs.dialogueTrack} onOpen={openPath} />
              <FileResult label="英文成片混音 MX+FX" file={englishDubbing.outputs.mixedTrack} onOpen={openPath} />
              <FileResult label="英文整轨合成结果" file={englishDubbing.outputs.assemblyReport} onOpen={openPath} />
            </div>
          )}
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
        </div>
        <div className="workflow-card manual-step final-video-step">
          <p className="eyebrow">步骤 07</p>
          <h2>替换英文音轨并烧录字幕</h2>
          <p>用英文成片混音替换原视频音频，并将受控英文字幕按所选样式烧录到视频中，输出最终英文成片。</p>
          <div className={`step-status ${finalVideo?.status || "blocked"}`}>
            <strong>
              {finalVideo?.status === "running" && "正在生成最终成片"}
              {finalVideo?.status === "completed" && "最终英文成片已生成"}
              {finalVideo?.status === "failed" && "成片生成失败"}
              {finalVideo?.status === "unavailable" && "不可执行"}
              {(!finalVideo || finalVideo.status === "blocked") && "等待英文混音与字幕"}
              {finalVideo?.status === "ready" && "可以开始"}
            </strong>
            <small>
              {finalVideo?.status === "running"
                ? "正在编码视频、烧录字幕并替换音频，页面会自动刷新状态。"
                : finalVideo?.canRun
                  ? "受控英文字幕与英文成片混音已齐全，可先生成参考帧确认样式。"
                  : "需先完成步骤 06 的字幕预检与英文成片混音。"}
            </small>
          </div>
          {finalVideo?.inputs && (
            <div className="track-results input-results final-input-results">
              <FileResult label="原视频画面" file={finalVideo.inputs.video} onOpen={openPath} readyText="已就绪" />
              <FileResult label="受控英文字幕 SRT" file={finalVideo.inputs.subtitle} onOpen={openPath} readyText="已就绪" />
              <FileResult label="替换音轨：英文成片混音" file={finalVideo.inputs.audio} onOpen={openPath} readyText="已就绪" />
            </div>
          )}
          <section className="subtitle-style-panel" aria-label="英文字幕样式设置">
            <div className="style-panel-heading">
              <strong>字幕样式</strong>
              <small>先生成三帧参考画面，确认后再编码完整视频。</small>
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
              <label className="style-field range-field">
                <span>底部距离 <strong>{finalVideoStyle.bottomMargin}px</strong></span>
                <input
                  min="20"
                  max="500"
                  type="range"
                  value={finalVideoStyle.bottomMargin}
                  onChange={(event) =>
                    updateFinalVideoStyle("bottomMargin", Number(event.target.value))
                  }
                />
              </label>
            </div>
            <button
              className="secondary-button preview-action"
              disabled={isGeneratingFinalVideoPreview || !finalVideo?.canPreview}
              type="button"
              onClick={generateFinalVideoPreview}
            >
              {isGeneratingFinalVideoPreview ? "正在生成参考帧..." : "生成字幕样式参考帧"}
            </button>
            {finalVideo?.previews?.some((preview) => preview.ready) && (
              <div className="preview-grid">
                {finalVideo.previews
                  .filter((preview) => preview.ready)
                  .map((preview, index) => (
                    <figure key={preview.path}>
                      <img
                        alt={`字幕样式参考帧 ${index + 1}`}
                        src={`${preview.url}?v=${previewVersion}`}
                      />
                      <figcaption>参考帧 {String(index + 1).padStart(2, "0")}</figcaption>
                    </figure>
                  ))}
              </div>
            )}
          </section>
          <DirectoryResult
            label="最终成片输出目录"
            path={finalVideo?.outputDirectory}
            ready={finalVideo?.outputDirectoryReady}
            onOpen={openPath}
          />
          {finalVideo?.outputs && (
            <div className="track-results">
              <FileResult label="成片字幕 ASS" file={finalVideo.outputs.styledAss} onOpen={openPath} />
              <FileResult label="最终英文成片 MP4" file={finalVideo.outputs.video} onOpen={openPath} />
              <FileResult label="成片结果报告" file={finalVideo.outputs.report} onOpen={openPath} />
            </div>
          )}
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
        </div>
      </section>
    </main>
  );
}

function App() {
  const [videos, setVideos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showPathDialog, setShowPathDialog] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

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

  const handleDelete = async (id) => {
    try {
      await requestJson(`/api/videos/${id}`, { method: "DELETE" });
      await loadVideos();
      navigate("/");
    } catch (error) {
      setMessage(`视频删除失败：${error.message}`);
    }
  };

  return (
    <div className="application">
      <Sidebar
        videos={videos}
        isLoading={isLoading}
        isSaving={isSaving}
        onAddPath={() => setShowPathDialog(true)}
        onDelete={handleDelete}
      />
      {showPathDialog && (
        <PathDialog
          isSaving={isSaving}
          value={sourcePath}
          onChange={setSourcePath}
          onClose={() => {
            if (!isSaving) {
              setShowPathDialog(false);
            }
          }}
          onSubmit={handleRegister}
        />
      )}
      {message && <div className="toast">{message}</div>}
      <Routes>
        <Route
          path="/"
          element={
            <WelcomePage
              isSaving={isSaving}
              onAddPath={() => setShowPathDialog(true)}
            />
          }
        />
        <Route path="/video/:videoId" element={<VideoPage videos={videos} isLoading={isLoading} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
