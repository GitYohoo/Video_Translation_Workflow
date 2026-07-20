import fs from "node:fs/promises";

const styleFiles = [
  "01-foundation.css",
  "02-application-shell.css",
  "03-production-workbench.css",
  "04-responsive.css",
  "05-desktop-overrides.css",
];

export async function readStyleSource() {
  const sources = await Promise.all(
    styleFiles.map((fileName) =>
      fs.readFile(new URL(`../src/styles/${fileName}`, import.meta.url), "utf8"),
    ),
  );
  return sources.join("\n");
}
