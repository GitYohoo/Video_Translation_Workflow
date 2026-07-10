import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { parseSingleByteRange, sendMediaFile } from "../server/media-stream.js";

async function withMediaServer(filePath, callback) {
  const app = express();
  app.get("/media", async (request, response, next) => {
    try {
      await sendMediaFile(request, response, filePath, {
        contentType: "video/mp4",
        cacheControl: "no-store",
      });
    } catch (error) {
      next(error);
    }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}/media`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("parses suffix, open-ended, and oversized byte ranges", () => {
  assert.deepEqual(parseSingleByteRange("bytes=-500", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseSingleByteRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseSingleByteRange("bytes=0-5000", 1000), { start: 0, end: 999 });
  assert.equal(parseSingleByteRange("bytes=1000-", 1000), null);
  assert.equal(parseSingleByteRange("bytes=0-1,4-5", 1000), null);
});

test("streams valid ranges and rejects unsupported ranges", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-media-stream-"));
  const filePath = path.join(directory, "sample.mp4");
  await fs.writeFile(filePath, "0123456789", "utf8");
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  await withMediaServer(filePath, async (url) => {
    const suffix = await fetch(url, { headers: { Range: "bytes=-4" } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get("content-range"), "bytes 6-9/10");
    assert.equal(suffix.headers.get("content-length"), "4");
    assert.equal(await suffix.text(), "6789");

    const oversized = await fetch(url, { headers: { Range: "bytes=0-999" } });
    assert.equal(oversized.status, 206);
    assert.equal(oversized.headers.get("content-range"), "bytes 0-9/10");
    assert.equal(await oversized.text(), "0123456789");

    const unsupported = await fetch(url, { headers: { Range: "bytes=0-1,4-5" } });
    assert.equal(unsupported.status, 416);
    assert.equal(unsupported.headers.get("content-range"), "bytes */10");
  });
});
