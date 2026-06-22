const subtitlePositionRange = {
  min: 0,
  max: 100,
};

const subtitleFontSizeRange = {
  min: 18,
  max: 96,
};

export function clampSubtitlePosition(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 50;
  }
  return Math.min(subtitlePositionRange.max, Math.max(subtitlePositionRange.min, numericValue));
}

export function clampSubtitleFontSize(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 50;
  }
  return Math.min(
    subtitleFontSizeRange.max,
    Math.max(subtitleFontSizeRange.min, Math.round(numericValue)),
  );
}

export function subtitlePositionFromPointer(clientX, clientY, rect) {
  const pointerX = Number(clientX);
  const pointerY = Number(clientY);
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (
    !Number.isFinite(pointerX) ||
    !Number.isFinite(pointerY) ||
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(pointerY)
  ) {
    return { positionX: 50, positionY: 50 };
  }
  return {
    positionX: clampSubtitlePosition(((pointerX - left) / width) * 100),
    positionY: clampSubtitlePosition(((pointerY - top) / height) * 100),
  };
}

export function subtitlePositionFromDrag(
  startPosition,
  startPointer,
  currentPointer,
  rect,
) {
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return {
      positionX: clampSubtitlePosition(startPosition?.positionX),
      positionY: clampSubtitlePosition(startPosition?.positionY),
    };
  }
  return {
    positionX: clampSubtitlePosition(
      Number(startPosition?.positionX) +
        ((Number(currentPointer?.clientX) - Number(startPointer?.clientX)) / width) * 100,
    ),
    positionY: clampSubtitlePosition(
      Number(startPosition?.positionY) +
        ((Number(currentPointer?.clientY) - Number(startPointer?.clientY)) / height) * 100,
    ),
  };
}

export function subtitlePositionStyle(positionX, positionY) {
  return {
    left: `${clampSubtitlePosition(positionX)}%`,
    top: `${clampSubtitlePosition(positionY)}%`,
  };
}

export function fontSizeFromResize(startFontSize, startDistance, currentDistance) {
  const initialDistance = Number(startDistance);
  const nextDistance = Number(currentDistance);
  if (
    !Number.isFinite(initialDistance) ||
    initialDistance <= 0 ||
    !Number.isFinite(nextDistance)
  ) {
    return clampSubtitleFontSize(startFontSize);
  }
  return clampSubtitleFontSize(Number(startFontSize) * (nextDistance / initialDistance));
}
