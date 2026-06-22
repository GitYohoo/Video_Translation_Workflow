import assert from "node:assert/strict";
import test from "node:test";
import { loadDesktopApplication } from "../electron/startup-navigation.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("waits for the splash navigation before loading the backend page", async () => {
  const splash = deferred();
  const backend = deferred();
  const calls = [];
  const window = {
    loadFile(filePath) {
      calls.push(["loadFile", filePath]);
      return splash.promise;
    },
    loadURL(url) {
      calls.push(["loadURL", url]);
      return Promise.resolve();
    },
  };

  const loading = loadDesktopApplication({
    window,
    splashPath: "electron/splash.html",
    onServerReady(listener) {
      calls.push(["serverReady", listener.url]);
    },
    startServer() {
      calls.push(["startServer"]);
      return backend.promise;
    },
  });

  backend.resolve({ url: "http://127.0.0.1:4321" });
  await Promise.resolve();
  assert.deepEqual(calls, [
    ["loadFile", "electron/splash.html"],
    ["startServer"],
  ]);

  splash.resolve();
  const listener = await loading;

  assert.equal(listener.url, "http://127.0.0.1:4321");
  assert.deepEqual(calls, [
    ["loadFile", "electron/splash.html"],
    ["startServer"],
    ["serverReady", "http://127.0.0.1:4321"],
    ["loadURL", "http://127.0.0.1:4321"],
  ]);
});
