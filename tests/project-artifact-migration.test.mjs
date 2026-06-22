import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateProjectArtifacts } from "../server/project-artifact-migration.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-migration-"));
  const sourceDirectory = path.join(root, "source");
  const workspaceDirectory = path.join(root, "workspace");
  const reportDirectory = path.join(root, "reports");
  const sourcePath = path.join(sourceDirectory, "示例.mp4");
  const catalogPath = path.join(root, "videos.json");
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.mkdir(workspaceDirectory, { recursive: true });
  await fs.writeFile(sourcePath, "video", "utf8");
  await fs.writeFile(
    catalogPath,
    JSON.stringify([
      {
        id: "video-1",
        name: "示例.mp4",
        sourcePath,
        workspaceDirectory,
        size: 5,
      },
    ]),
    "utf8",
  );
  return { root, sourceDirectory, workspaceDirectory, reportDirectory, catalogPath };
}

test("migrates files beside the source video with deduplication and conflict backup", async () => {
  const paths = await fixture();
  await fs.mkdir(path.join(paths.workspaceDirectory, "OCR_字幕校准"), { recursive: true });
  await fs.mkdir(path.join(paths.sourceDirectory, "OCR_字幕校准"), { recursive: true });
  await fs.writeFile(
    path.join(paths.workspaceDirectory, "OCR_字幕校准", "same.srt"),
    "same",
    "utf8",
  );
  await fs.writeFile(
    path.join(paths.sourceDirectory, "OCR_字幕校准", "same.srt"),
    "same",
    "utf8",
  );
  await fs.writeFile(
    path.join(paths.workspaceDirectory, "OCR_字幕校准", "changed.srt"),
    "new",
    "utf8",
  );
  await fs.writeFile(
    path.join(paths.sourceDirectory, "OCR_字幕校准", "changed.srt"),
    "old",
    "utf8",
  );

  const report = await migrateProjectArtifacts({
    catalogPath: paths.catalogPath,
    reportDirectory: paths.reportDirectory,
    timestamp: "20260622-120000",
  });

  assert.equal(
    await fs.readFile(path.join(paths.sourceDirectory, "OCR_字幕校准", "changed.srt"), "utf8"),
    "new",
  );
  assert.equal(
    await fs.readFile(
      path.join(
        paths.sourceDirectory,
        "产物迁移备份_20260622-120000",
        "OCR_字幕校准",
        "changed.srt",
      ),
      "utf8",
    ),
    "old",
  );
  await assert.rejects(fs.access(paths.workspaceDirectory));
  const catalog = JSON.parse(await fs.readFile(paths.catalogPath, "utf8"));
  assert.equal("workspaceDirectory" in catalog[0], false);
  assert.equal(report.projects[0].copied, 1);
  assert.equal(report.projects[0].deduplicated, 1);
  assert.equal(report.projects[0].backedUp, 1);
});

test("dry run leaves files and catalog unchanged", async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.workspaceDirectory, "result.txt"), "result", "utf8");

  const report = await migrateProjectArtifacts({
    catalogPath: paths.catalogPath,
    reportDirectory: paths.reportDirectory,
    timestamp: "20260622-120000",
    dryRun: true,
  });

  await fs.access(paths.workspaceDirectory);
  await assert.rejects(fs.access(path.join(paths.sourceDirectory, "result.txt")));
  const catalog = JSON.parse(await fs.readFile(paths.catalogPath, "utf8"));
  assert.equal(catalog[0].workspaceDirectory, paths.workspaceDirectory);
  assert.equal(report.dryRun, true);
  assert.equal(report.projects[0].planned, 1);
});

test("refuses to delete a legacy directory outside the configured workspace root", async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.workspaceDirectory, "result.txt"), "result", "utf8");

  const report = await migrateProjectArtifacts({
    catalogPath: paths.catalogPath,
    reportDirectory: paths.reportDirectory,
    workspaceRoot: path.join(paths.root, "different-root"),
    timestamp: "20260622-120000",
  });

  assert.equal(report.projects[0].status, "failed");
  assert.match(report.projects[0].error, /不在允许的历史项目根目录内/);
  await fs.access(paths.workspaceDirectory);
  const catalog = JSON.parse(await fs.readFile(paths.catalogPath, "utf8"));
  assert.equal(catalog[0].workspaceDirectory, paths.workspaceDirectory);
});
