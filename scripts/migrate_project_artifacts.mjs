import path from "node:path";
import { migrateProjectArtifacts } from "../server/project-artifact-migration.js";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const dataDirectory = option(
  "data-directory",
  process.env.VIDEO_TRANSLATION_DATA_DIR || "D:\\VideoTranslationWorkflow\\data",
);
const report = await migrateProjectArtifacts({
  catalogPath: option("catalog", path.join(dataDirectory, "videos.json")),
  reportDirectory: option(
    "report-directory",
    path.join(dataDirectory, "migration-reports"),
  ),
  workspaceRoot: option("workspace-root", "D:\\VideoTranslationProjects"),
  dryRun: process.argv.includes("--dry-run"),
});

console.log(JSON.stringify({
  dryRun: report.dryRun,
  projects: report.projects.map((project) => ({
    name: project.name,
    status: project.status,
    planned: project.planned,
    copied: project.copied,
    deduplicated: project.deduplicated,
    backedUp: project.backedUp,
    error: project.error,
  })),
  orphanDirectories: report.orphanDirectories,
  jsonPath: report.jsonPath,
  htmlPath: report.htmlPath,
}, null, 2));

if (report.projects.some((project) => project.status === "failed")) {
  process.exitCode = 1;
}
