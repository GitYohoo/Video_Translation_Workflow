import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampSubtitleFontSize,
  clampSubtitlePosition,
  fontSizeFromResize,
  subtitlePreviewFontSize,
  subtitlePositionFromDrag,
  subtitlePositionStyle,
} from "../final-video-style.js";

export function SubtitlePreviewFigure({
  preview,
  previewVersion,
  previewText,
  style,
  onStyleChange,
}) {
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const interactionRef = useRef(null);
  const draftStyleRef = useRef(null);
  const [interactionMode, setInteractionMode] = useState("");
  const [draftStyle, setDraftStyle] = useState(null);
  const [sourceHeight, setSourceHeight] = useState(1080);
  const [displayHeight, setDisplayHeight] = useState(0);
  const effectiveStyle = draftStyle || style;
  const position = subtitlePositionStyle(
    effectiveStyle.positionX,
    effectiveStyle.positionY,
  );
  const previewFontSize = subtitlePreviewFontSize(
    effectiveStyle.fontSize,
    displayHeight,
    sourceHeight,
  );
  const backgroundAlpha = Math.round(
    Math.min(1, Math.max(0, Number(effectiveStyle.backgroundOpacity))) * 255,
  )
    .toString(16)
    .padStart(2, "0");

  const updateImageMeasurements = useCallback(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }
    setSourceHeight(image.naturalHeight || 1080);
    setDisplayHeight(image.clientHeight);
  }, []);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(updateImageMeasurements);
    observer.observe(image);
    return () => observer.disconnect();
  }, [updateImageMeasurements]);

  const stopInteraction = useCallback((event) => {
    if (!interactionRef.current) {
      return;
    }
    interactionRef.current = null;
    setInteractionMode("");
    if (draftStyleRef.current) {
      onStyleChange(draftStyleRef.current);
    }
    draftStyleRef.current = null;
    setDraftStyle(null);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can already be gone after cancellation.
    }
  }, [onStyleChange]);

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== 0) {
        return;
      }
      const frame = frameRef.current;
      if (!frame) {
        return;
      }
      event.preventDefault();
      draftStyleRef.current = { ...style };
      setDraftStyle({ ...style });
      const resizeHandle = event.target.closest?.("[data-resize-handle]");
      if (resizeHandle) {
        const boxRect = event.currentTarget.getBoundingClientRect();
        const centerX = boxRect.left + boxRect.width / 2;
        const centerY = boxRect.top + boxRect.height / 2;
        interactionRef.current = {
          mode: "resize",
          centerX,
          centerY,
          startDistance: Math.hypot(event.clientX - centerX, event.clientY - centerY),
          startFontSize: style.fontSize,
        };
        setInteractionMode("resize");
      } else {
        interactionRef.current = {
          mode: "drag",
          startPosition: {
            positionX: style.positionX,
            positionY: style.positionY,
          },
          startPointer: {
            clientX: event.clientX,
            clientY: event.clientY,
          },
        };
        setInteractionMode("drag");
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [style.fontSize, style.positionX, style.positionY],
  );

  const handlePointerMove = useCallback(
    (event) => {
      const interaction = interactionRef.current;
      const frame = frameRef.current;
      if (!interaction || !frame) {
        return;
      }
      event.preventDefault();
      if (interaction.mode === "drag") {
        const nextPosition = subtitlePositionFromDrag(
          interaction.startPosition,
          interaction.startPointer,
          { clientX: event.clientX, clientY: event.clientY },
          frame.getBoundingClientRect(),
        );
        const nextStyle = { ...(draftStyleRef.current || style), ...nextPosition };
        draftStyleRef.current = nextStyle;
        setDraftStyle(nextStyle);
        return;
      }
      const currentDistance = Math.hypot(
        event.clientX - interaction.centerX,
        event.clientY - interaction.centerY,
      );
      const nextStyle = {
        ...(draftStyleRef.current || style),
        fontSize: fontSizeFromResize(
          interaction.startFontSize,
          interaction.startDistance,
          currentDistance,
        ),
      };
      draftStyleRef.current = nextStyle;
      setDraftStyle(nextStyle);
    },
    [style],
  );

  const handleKeyDown = useCallback(
    (event) => {
      const step = event.shiftKey ? 2 : 0.5;
      const positionChanges = {
        ArrowLeft: { positionX: clampSubtitlePosition(style.positionX - step) },
        ArrowRight: { positionX: clampSubtitlePosition(style.positionX + step) },
        ArrowUp: { positionY: clampSubtitlePosition(style.positionY - step) },
        ArrowDown: { positionY: clampSubtitlePosition(style.positionY + step) },
      };
      if (event.key in positionChanges) {
        event.preventDefault();
        onStyleChange(positionChanges[event.key]);
        return;
      }
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        onStyleChange({
          fontSize: clampSubtitleFontSize(
            style.fontSize + (event.key === "-" ? -2 : 2),
          ),
        });
      }
    },
    [onStyleChange, style.fontSize, style.positionX, style.positionY],
  );

  return (
    <figure className="subtitle-editor-preview">
      <div className={`subtitle-preview-frame ${interactionMode ? "interacting" : ""}`}>
        <div
          ref={frameRef}
          className="subtitle-preview-canvas"
        >
          <img
            ref={imageRef}
            alt="字幕位置编辑参考帧"
            src={`${preview.url}?v=${previewVersion}`}
            onLoad={updateImageMeasurements}
          />
          {interactionMode && (
            <>
              <span className="subtitle-canvas-guide vertical" style={{ left: position.left }} />
              <span className="subtitle-canvas-guide horizontal" style={{ top: position.top }} />
            </>
          )}
          <div
            aria-label={`拖动字幕调整位置，拖动四角调整大小。当前位置横向 ${Math.round(effectiveStyle.positionX)}%，纵向 ${Math.round(effectiveStyle.positionY)}%，字号 ${effectiveStyle.fontSize}`}
            className={`subtitle-edit-box ${interactionMode || ""}`}
            role="button"
            tabIndex="0"
            title="拖动字幕移动；拖动四角调整大小"
            style={{
              ...position,
              backgroundColor: `${effectiveStyle.backgroundColor}${backgroundAlpha}`,
              color: effectiveStyle.textColor,
              fontFamily: effectiveStyle.fontName,
              fontSize: `${previewFontSize}px`,
            }}
            onKeyDown={handleKeyDown}
            onPointerCancel={stopInteraction}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopInteraction}
          >
            <span className="subtitle-edit-text">{previewText}</span>
            {["nw", "ne", "sw", "se"].map((handle) => (
              <span
                aria-hidden="true"
                className={`subtitle-resize-handle ${handle}`}
                data-resize-handle={handle}
                key={handle}
              />
            ))}
          </div>
        </div>
      </div>
      <figcaption>
        直接拖动字幕放置位置，拖动四角调整大小；最终视频会直接采用这里的参数。
      </figcaption>
    </figure>
  );
}
