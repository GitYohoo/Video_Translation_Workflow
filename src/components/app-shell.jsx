import { Link, NavLink } from "react-router-dom";
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
import { formatSize } from "../format.js";

export function VideoThumbnail({ video }) {
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

export function Sidebar({
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
      <Link className="brand" to="/" style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}>
        <span className="brand-mark" aria-hidden="true">
          <Clapperboard size={20} strokeWidth={2.2} />
        </span>
        <span className="brand-copy">
          <strong className="brand-label">影译工坊</strong>
          <small>本地视频制作台</small>
        </span>
      </Link>
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

export function WelcomePage({ videos, isAddingVideo, onAddPath }) {
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

export function DesktopTitlebar({ desktopInfo, onOpenSettings }) {
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

export function DesktopSettingsDialog({ info, onClose, onOpenDirectory, onChooseRuntime }) {
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

export function PathDialog({
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
