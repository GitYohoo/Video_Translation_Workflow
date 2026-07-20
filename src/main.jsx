import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { requestJson } from "./api.js";
import { useVideoList } from "./use-video-data.js";
import {
  DesktopSettingsDialog,
  DesktopTitlebar,
  PathDialog,
  Sidebar,
  WelcomePage,
} from "./components/app-shell.jsx";
import { SimplifiedVideoPage } from "./pages/simplified-video-page.jsx";
import "./styles.css";

function App() {
  const {
    videos,
    isLoading,
    errorMessage: videoListError,
    mutate: refreshVideos,
  } = useVideoList();
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
      await refreshVideos();
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
      await refreshVideos();
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
      await refreshVideos();
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
        {(message || videoListError) && (
          <div className="toast">{message || `视频列表读取失败：${videoListError}`}</div>
        )}
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
