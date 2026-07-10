import { createReadStream } from "node:fs";
import fs from "node:fs/promises";

export function parseSingleByteRange(rangeHeader, size) {
  if (!Number.isSafeInteger(size) || size <= 0 || typeof rangeHeader !== "string") {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return null;
  }

  if (!match[2]) {
    return { start, end: size - 1 };
  }

  const requestedEnd = Number(match[2]);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

export async function sendMediaFile(
  request,
  response,
  filePath,
  { contentType, cacheControl } = {},
) {
  const stats = await fs.stat(filePath);
  const rangeHeader = request.headers.range;
  if (contentType) {
    response.setHeader("Content-Type", contentType);
  }
  response.setHeader("Accept-Ranges", "bytes");
  if (cacheControl) {
    response.setHeader("Cache-Control", cacheControl);
  }

  if (!rangeHeader) {
    response.setHeader("Content-Length", stats.size);
    createReadStream(filePath).pipe(response);
    return;
  }

  const range = parseSingleByteRange(rangeHeader, stats.size);
  if (!range) {
    response.status(416).setHeader("Content-Range", `bytes */${stats.size}`).end();
    return;
  }

  response.status(206);
  response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
  response.setHeader("Content-Length", range.end - range.start + 1);
  createReadStream(filePath, range).pipe(response);
}
