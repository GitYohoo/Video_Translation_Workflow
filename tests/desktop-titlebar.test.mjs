import assert from "node:assert/strict";
import test from "node:test";

import { readStyleSource } from "./style-source.mjs";

const styles = await readStyleSource();
const desktopVisualSystemStart = styles.indexOf("/* Desktop application visual system */");
const desktopTitlebarStart = styles.indexOf(".desktop-titlebar {", desktopVisualSystemStart);
const titlebarStyles = styles.slice(
  desktopTitlebarStart,
  styles.indexOf(".desktop-titlebar-brand", desktopTitlebarStart),
);

test("keeps the desktop titlebar above scrolling page content", () => {
  assert.match(titlebarStyles, /position:\s*sticky/);
  assert.match(titlebarStyles, /top:\s*0/);
  assert.match(titlebarStyles, /z-index:\s*\d+/);
});
