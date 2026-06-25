import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createLogServer } from "../src/server.js";
import type { LogServerResult } from "../src/types.js";

let workingDirectory: string;
let started: LogServerResult | null = null;

beforeEach(() => {
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-debug-test-"));
});

afterEach(() => {
  started?.server?.close();
  started = null;
  fs.rmSync(workingDirectory, { recursive: true, force: true });
});

const postLog = (endpoint: string, body: unknown): Promise<Response> =>
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("appends posted logs, reads them back, dedups by id, and clears on DELETE", async () => {
  started = await createLogServer({ cwd: workingDirectory });
  const { endpoint, logPath } = started.info;

  await postLog(endpoint, { id: "a", hypothesisId: "A", message: "first" });
  await postLog(endpoint, { id: "a", hypothesisId: "A", message: "duplicate ignored" });
  await postLog(endpoint, { id: "b", hypothesisId: "B", message: "second" });

  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(JSON.parse(lines[0]).timestamp).toBeTypeOf("number");

  const read = await (await fetch(endpoint)).text();
  expect(read.trim().split("\n")).toHaveLength(2);

  await fetch(endpoint, { method: "DELETE" });
  expect(fs.existsSync(logPath)).toBe(false);
});

test("a second start reuses the running server instead of binding a new port", async () => {
  started = await createLogServer({ cwd: workingDirectory });
  const second = await createLogServer({ cwd: workingDirectory });

  expect(second.reused).toBe(true);
  expect(second.server).toBeNull();
  expect(second.info.port).toBe(started.info.port);
});

test("reusing with a requested session id returns that session's endpoint and log path", async () => {
  started = await createLogServer({ cwd: workingDirectory });
  const reused = await createLogServer({ cwd: workingDirectory, sessionId: "custom-session" });

  expect(reused.reused).toBe(true);
  expect(reused.info.sessionId).toBe("custom-session");
  expect(reused.info.port).toBe(started.info.port);
  expect(reused.info.endpoint).toBe(`http://127.0.0.1:${started.info.port}/ingest/custom-session`);
  expect(reused.info.logPath).not.toBe(started.info.logPath);
  expect(reused.info.logPath).toContain("custom-session");

  // The running server accepts the on-demand session and writes it where the
  // reused info said it would.
  await postLog(reused.info.endpoint, { id: "x", message: "on the custom session" });
  expect(fs.existsSync(reused.info.logPath)).toBe(true);
});
