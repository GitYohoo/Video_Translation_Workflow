import { speakerToneClass } from "../dubbing-utils.js";

export function DubbingSegmentEditorPanel({
  segments,
  selectedSegment,
  draft,
  message,
  versionKey,
  disabled,
  busy,
  onSelect,
  onDraftChange,
  onChooseReferenceAudio,
  onRegenerate,
}) {
  if (!segments.length) {
    return null;
  }
  return (
    <>
      {message && <p className="workflow-message">{message}</p>}
      <section className="dubbing-segment-editor" aria-label="配音条目编辑器">
        <div className="dubbing-segment-list-panel">
          <div className="segment-panel-heading">
            <strong>配音条目</strong>
            <span>{segments.length} 条</span>
          </div>
          <div className="dubbing-segment-list">
            {segments.map((segment) => (
              <button
                className={`dubbing-segment-row ${speakerToneClass(segment.speaker)} ${
                  segment.number === selectedSegment?.number ? "active" : ""
                }`}
                key={segment.number}
                type="button"
                onClick={() => onSelect(segment)}
              >
                <span className={`segment-number ${speakerToneClass(segment.speaker)}`}>
                  {segment.displayNumber}
                </span>
                <span className="segment-main">
                  <strong>{segment.speaker}</strong>
                  <small>
                    {segment.start} - {segment.end}
                  </small>
                  <span>{segment.text}</span>
                </span>
                <span className={`segment-ready ${segment.fittedAudio?.ready ? "ready" : "missing"}`}>
                  {segment.fittedAudio?.ready ? "可试听" : "未生成"}
                </span>
              </button>
            ))}
          </div>
        </div>
        {selectedSegment && draft && (
          <div className="dubbing-segment-detail">
            <div className="segment-panel-heading">
              <strong>配音详情</strong>
              <span>第 {selectedSegment.displayNumber} 条</span>
            </div>
            <div className="segment-detail-grid">
              <span>时间段</span>
              <strong>
                {selectedSegment.start} - {selectedSegment.end}
              </strong>
              <span>目标时长</span>
              <strong>{selectedSegment.durationSeconds || "-"} 秒</strong>
              <span>生成角色</span>
              <strong>{selectedSegment.role || "未生成"}</strong>
              <span>变速系数</span>
              <strong>{selectedSegment.speedFactor || "-"}</strong>
            </div>
            {selectedSegment.fittedAudio?.ready && (
              <label className="segment-audio-player">
                <span>当前配音试听</span>
                <audio
                  controls
                  preload="none"
                  src={`${selectedSegment.fittedAudio.url}&v=${versionKey || ""}`}
                />
              </label>
            )}
            <div className="segment-audio-player reference-audio-player">
              <span>参考音频试听</span>
              {selectedSegment.referenceAudio?.ready ? (
                <audio
                  controls
                  preload="none"
                  src={`${selectedSegment.referenceAudio.url}&v=${versionKey || ""}`}
                />
              ) : (
                <small>未找到参考音频</small>
              )}
              <button
                className="secondary-button compact"
                disabled={disabled || busy}
                type="button"
                onClick={onChooseReferenceAudio}
              >
                更改参考音频
              </button>
              {draft.referenceAudioName && (
                <small className="reference-audio-name">已选：{draft.referenceAudioName}</small>
              )}
            </div>
            <div className="segment-edit-grid">
              <label>
                <span>说话人</span>
                <input
                  type="text"
                  value={draft.speaker}
                  onChange={(event) => onDraftChange({ ...draft, speaker: event.target.value })}
                />
              </label>
              <label className="segment-text-field">
                <span>配音内容</span>
                <textarea
                  rows={4}
                  value={draft.text}
                  onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
                />
              </label>
            </div>
            <button
              className="primary-button workflow-action"
              disabled={disabled || busy}
              type="button"
              onClick={onRegenerate}
            >
              {busy ? "正在提交..." : "重新配音该条并合成整轨"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
