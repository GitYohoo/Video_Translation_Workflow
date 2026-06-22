import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

async function exists(candidatePath) {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function fileHash(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function listFiles(directory, relativeDirectory = "") {
  const entries = await fs.readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function normalizedPath(candidatePath) {
  return path.resolve(candidatePath).toLocaleLowerCase();
}

function isWithinDirectory(candidatePath, rootDirectory) {
  const relativePath = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

async function copyVerified(sourcePath, destinationPath, expectedHash) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  const copiedHash = await fileHash(destinationPath);
  if (copiedHash !== expectedHash) {
    throw new Error(`文件校验失败：${destinationPath}`);
  }
}

async function replaceVerified({
  sourcePath,
  destinationPath,
  backupPath,
  expectedHash,
}) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.migration-${crypto.randomUUID()}.tmp`;
  const rollbackPath = `${destinationPath}.migration-${crypto.randomUUID()}.rollback`;
  await copyVerified(sourcePath, temporaryPath, expectedHash);
  try {
    if (backupPath) {
      const existingHash = await fileHash(destinationPath);
      await copyVerified(destinationPath, backupPath, existingHash);
      await fs.rename(destinationPath, rollbackPath);
      try {
        await fs.rename(temporaryPath, destinationPath);
      } catch (error) {
        await fs.rename(rollbackPath, destinationPath).catch(() => {});
        throw error;
      }
      await fs.rm(rollbackPath, { force: true });
    } else {
      await fs.rename(temporaryPath, destinationPath);
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    await fs.rm(rollbackPath, { force: true }).catch(() => {});
  }
  const destinationHash = await fileHash(destinationPath);
  if (destinationHash !== expectedHash) {
    throw new Error(`目标文件最终校验失败：${destinationPath}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function reportHtml(report) {
  const rows = report.projects
    .map(
      (project) => `<tr>
        <td>${escapeHtml(project.name)}</td>
        <td>${escapeHtml(project.status)}</td>
        <td>${project.planned}</td>
        <td>${project.copied}</td>
        <td>${project.deduplicated}</td>
        <td>${project.backedUp}</td>
        <td>${escapeHtml(project.error || "")}</td>
      </tr>`,
    )
    .join("");
  const orphans = report.orphanDirectories
    .map((directory) => `<li><code>${escapeHtml(directory)}</code></li>`)
    .join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>项目产物迁移报告</title>
<style>body{max-width:1100px;margin:32px auto;font:15px/1.6 system-ui,sans-serif;color:#18212f}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5df;padding:8px;text-align:left}th{background:#eef2f6}code{background:#eef2f6;padding:2px 5px}</style>
</head><body><h1>项目产物迁移报告</h1>
<p>模式：${report.dryRun ? "预检" : "正式迁移"}；时间：${escapeHtml(report.timestamp)}</p>
<table><thead><tr><th>项目</th><th>状态</th><th>计划文件</th><th>复制</th><th>去重</th><th>备份</th><th>错误</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>未关联目录</h2><ul>${orphans || "<li>无</li>"}</ul></body></html>`;
}

async function writeCatalog(catalogPath, catalog) {
  const temporaryPath = `${catalogPath}.migration.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(catalog, null, 2), "utf8");
  await fs.rename(temporaryPath, catalogPath);
}

async function orphanDirectories(workspaceRoot, referencedDirectories) {
  if (!workspaceRoot || !(await exists(workspaceRoot))) {
    return [];
  }
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((directory) => !referencedDirectories.has(normalizedPath(directory)));
}

export async function migrateProjectArtifacts({
  catalogPath,
  reportDirectory,
  workspaceRoot = null,
  timestamp,
  dryRun = false,
}) {
  const migrationTimestamp =
    timestamp ||
    new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const referencedDirectories = new Set(
    catalog
      .map((record) => record.workspaceDirectory)
      .filter(Boolean)
      .map(normalizedPath),
  );
  const report = {
    timestamp: migrationTimestamp,
    dryRun,
    catalogPath,
    projects: [],
    orphanDirectories: await orphanDirectories(workspaceRoot, referencedDirectories),
  };
  const successfullyMigrated = [];

  for (const record of catalog.filter((item) => item.workspaceDirectory)) {
    const project = {
      id: record.id,
      name: record.name,
      sourceDirectory: record.workspaceDirectory,
      targetDirectory: record.sourcePath ? path.dirname(record.sourcePath) : null,
      status: "pending",
      planned: 0,
      copied: 0,
      deduplicated: 0,
      backedUp: 0,
      files: [],
      error: null,
    };
    report.projects.push(project);
    try {
      if (!record.sourcePath || !(await exists(record.sourcePath))) {
        throw new Error(`原视频不存在：${record.sourcePath || "未记录"}`);
      }
      if (!(await exists(record.workspaceDirectory))) {
        throw new Error(`历史项目目录不存在：${record.workspaceDirectory}`);
      }
      if (
        workspaceRoot &&
        !isWithinDirectory(record.workspaceDirectory, workspaceRoot)
      ) {
        throw new Error(
          `历史项目目录不在允许的历史项目根目录内：${record.workspaceDirectory}`,
        );
      }
      if (normalizedPath(record.workspaceDirectory) === normalizedPath(project.targetDirectory)) {
        project.status = dryRun ? "planned" : "completed";
        successfullyMigrated.push({ record, project, removeSource: false });
        continue;
      }
      const files = await listFiles(record.workspaceDirectory);
      project.planned = files.length;
      const backupRoot = path.join(
        project.targetDirectory,
        `产物迁移备份_${migrationTimestamp}`,
      );
      for (const relativePath of files) {
        const sourcePath = path.join(record.workspaceDirectory, relativePath);
        const destinationPath = path.join(project.targetDirectory, relativePath);
        const sourceHash = await fileHash(sourcePath);
        const destinationExists = await exists(destinationPath);
        let action = "copy";
        if (destinationExists) {
          const destinationHash = await fileHash(destinationPath);
          action = destinationHash === sourceHash ? "deduplicate" : "backup-and-replace";
        }
        project.files.push({ relativePath, action, sha256: sourceHash });
        if (dryRun) {
          continue;
        }
        if (action === "deduplicate") {
          project.deduplicated += 1;
          continue;
        }
        const backupPath =
          action === "backup-and-replace" ? path.join(backupRoot, relativePath) : null;
        await replaceVerified({
          sourcePath,
          destinationPath,
          backupPath,
          expectedHash: sourceHash,
        });
        project.copied += 1;
        if (backupPath) {
          project.backedUp += 1;
        }
      }
      project.status = dryRun ? "planned" : "verified";
      if (!dryRun) {
        successfullyMigrated.push({ record, project, removeSource: true });
      }
    } catch (error) {
      project.status = "failed";
      project.error = error.message;
    }
  }

  if (!dryRun && successfullyMigrated.length > 0) {
    for (const { record } of successfullyMigrated) {
      delete record.workspaceDirectory;
    }
    await writeCatalog(catalogPath, catalog);
    for (const { project, removeSource } of successfullyMigrated) {
      if (removeSource) {
        await fs.rm(project.sourceDirectory, { recursive: true, force: true });
      }
      project.status = "completed";
    }
  }

  await fs.mkdir(reportDirectory, { recursive: true });
  const reportBase = path.join(
    reportDirectory,
    `项目产物迁移_${migrationTimestamp}${dryRun ? "_预检" : ""}`,
  );
  report.jsonPath = `${reportBase}.json`;
  report.htmlPath = `${reportBase}.html`;
  await fs.writeFile(report.jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(report.htmlPath, reportHtml(report), "utf8");
  return report;
}
