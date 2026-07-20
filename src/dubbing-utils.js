import { pathLeafName } from "./path-display.js";

export function speakerToneClass(speaker = "") {
  const text = String(speaker || "未标注");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 6;
  }
  return `speaker-tone-${hash}`;
}

export function dubbingSegmentDraftFrom(segment) {
  if (!segment) {
    return null;
  }
  return {
    number: segment.number,
    speaker: segment.speaker || "",
    referenceAudioPath: segment.sourceAudio?.path || segment.referenceAudio?.path || "",
    referenceAudioName: pathLeafName(segment.referenceAudio?.path || segment.sourceAudio?.path || ""),
    text: segment.text || "",
  };
}
