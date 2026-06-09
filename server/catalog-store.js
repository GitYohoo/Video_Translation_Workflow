import fs from "node:fs/promises";

export function createCatalogStore(catalogPath) {
  async function loadCatalog() {
    try {
      return JSON.parse(await fs.readFile(catalogPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async function writeCatalog(videos) {
    const temporaryPath = `${catalogPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(videos, null, 2), "utf8");
    await fs.rename(temporaryPath, catalogPath);
  }

  async function findVideoById(id) {
    const videos = await loadCatalog();
    return videos.find((video) => video.id === id) || null;
  }

  function sortedVideos(videos) {
    return [...videos].sort((left, right) => right.createdAt - left.createdAt);
  }

  return {
    loadCatalog,
    writeCatalog,
    findVideoById,
    sortedVideos,
  };
}
