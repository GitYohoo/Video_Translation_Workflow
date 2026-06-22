import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSubtitleFontSize,
  clampSubtitlePosition,
  fontSizeFromResize,
  subtitlePositionFromDrag,
  subtitlePositionFromPointer,
  subtitlePositionStyle,
} from "../src/final-video-style.js";

test("clamps subtitle position to the video canvas", () => {
  assert.equal(clampSubtitlePosition(-12), 0);
  assert.equal(clampSubtitlePosition(52.5), 52.5);
  assert.equal(clampSubtitlePosition(130), 100);
});

test("maps direct subtitle dragging to normalized canvas coordinates", () => {
  const rect = { left: 100, top: 50, width: 800, height: 450 };

  assert.deepEqual(subtitlePositionFromPointer(500, 275, rect), {
    positionX: 50,
    positionY: 50,
  });
  assert.deepEqual(subtitlePositionFromPointer(20, 900, rect), {
    positionX: 0,
    positionY: 100,
  });
});

test("keeps the grabbed point stable while dragging the subtitle box", () => {
  const rect = { width: 800, height: 400 };

  assert.deepEqual(
    subtitlePositionFromDrag(
      { positionX: 50, positionY: 70 },
      { clientX: 300, clientY: 200 },
      { clientX: 380, clientY: 160 },
      rect,
    ),
    { positionX: 60, positionY: 60 },
  );
});

test("converts normalized subtitle coordinates into preview styles", () => {
  assert.deepEqual(subtitlePositionStyle(37.25, 81.5), {
    left: "37.25%",
    top: "81.5%",
  });
});

test("resizes subtitle font from a corner drag and keeps renderer limits", () => {
  assert.equal(fontSizeFromResize(50, 100, 150), 75);
  assert.equal(fontSizeFromResize(50, 100, 20), 18);
  assert.equal(fontSizeFromResize(80, 100, 200), 96);
  assert.equal(clampSubtitleFontSize(Number.NaN), 50);
});
