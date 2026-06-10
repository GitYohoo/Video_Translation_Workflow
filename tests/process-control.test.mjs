import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { terminateChildProcess } from "../server/process-control.js";

test("terminates a process tree with taskkill on Windows", async () => {
  const calls = [];
  const spawnProcess = (file, arguments_, options) => {
    calls.push({ file, arguments_, options });
    const process = new EventEmitter();
    queueMicrotask(() => process.emit("close", 0));
    return process;
  };

  const terminated = await terminateChildProcess(
    { pid: 321, exitCode: null, killed: false },
    { platform: "win32", spawnProcess },
  );

  assert.equal(terminated, true);
  assert.deepEqual(calls, [
    {
      file: "taskkill",
      arguments_: ["/PID", "321", "/T", "/F"],
      options: { windowsHide: true },
    },
  ]);
});

test("uses SIGTERM for non-Windows child processes", async () => {
  const signals = [];
  const child = {
    pid: 123,
    exitCode: null,
    killed: false,
    kill(signal) {
      signals.push(signal);
      return true;
    },
  };

  const terminated = await terminateChildProcess(child, { platform: "linux" });

  assert.equal(terminated, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("does nothing when the child process has already exited", async () => {
  assert.equal(await terminateChildProcess({ pid: 123, exitCode: 0, killed: false }), false);
  assert.equal(await terminateChildProcess(null), false);
});
