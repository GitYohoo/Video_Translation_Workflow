import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogStore } from "../server/catalog-store.js";

async function temporaryCatalogStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vt-catalog-"));
  const catalogPath = path.join(directory, "videos.json");
  return {
    directory,
    catalogPath,
    store: createCatalogStore(catalogPath),
  };
}

test("loads an empty catalog when the file does not exist", async () => {
  const { store } = await temporaryCatalogStore();

  assert.deepEqual(await store.loadCatalog(), []);
});

test("writes catalog atomically and loads it back", async () => {
  const { catalogPath, store } = await temporaryCatalogStore();
  const videos = [
    { id: "older", name: "older.mp4", createdAt: 10 },
    { id: "newer", name: "newer.mp4", createdAt: 20 },
  ];

  await store.writeCatalog(videos);

  assert.deepEqual(await store.loadCatalog(), videos);
  assert.equal(await fs.readFile(`${catalogPath}.tmp`, "utf8").catch(() => null), null);
});

test("finds videos by id and returns null when missing", async () => {
  const { store } = await temporaryCatalogStore();
  await store.writeCatalog([{ id: "video-1", name: "one.mp4", createdAt: 1 }]);

  assert.equal((await store.findVideoById("video-1")).name, "one.mp4");
  assert.equal(await store.findVideoById("missing"), null);
});

test("returns videos sorted newest first without mutating the input array", () => {
  const videos = [
    { id: "old", createdAt: 1 },
    { id: "new", createdAt: 3 },
    { id: "middle", createdAt: 2 },
  ];

  assert.deepEqual(
    createCatalogStore("unused").sortedVideos(videos).map((video) => video.id),
    ["new", "middle", "old"],
  );
  assert.deepEqual(videos.map((video) => video.id), ["old", "new", "middle"]);
});
