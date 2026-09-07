import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { checkSecurityScanCooperative } from "../src/check-security-scan.js";
import {
  createSecurityScanWorker,
  type SecurityScanWorker,
} from "../src/checks/security-scan/security-scan-worker.js";
import { parseSecurityScanWorkerResult } from "../src/checks/security-scan/security-scan-worker-protocol.js";
import {
  REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV,
  REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV,
  SECURITY_SCAN_WORKER_KILL_TIMEOUT_MS,
  SECURITY_SCAN_WORKER_SHUTDOWN_GRACE_MS,
  SECURITY_SCAN_WORKER_STARTUP_TIMEOUT_MS,
} from "../src/constants.js";
import type { Diagnostic } from "../src/types/index.js";

class FakeSecurityChild extends ChildProcess {
  readonly messages: unknown[] = [];
  closeOnDisconnect = true;
  closeOnKill = true;
  sendError: Error | null = null;

  constructor() {
    super();
    Object.defineProperty(this, "connected", { value: true, writable: true });
  }

  override send(message: unknown, ...arguments_: unknown[]): boolean {
    this.messages.push(message);
    const callback = arguments_.find((argument) => typeof argument === "function");
    if (typeof callback === "function") callback(this.sendError);
    return true;
  }

  override disconnect(): void {
    Object.defineProperty(this, "connected", { value: false });
    this.emit("disconnect");
    if (this.closeOnDisconnect) this.emit("close", 0, null);
  }

  override kill(): boolean {
    if (this.closeOnKill) this.emit("close", null, "SIGKILL");
    return true;
  }
}

const diagnostic: Diagnostic = {
  filePath: "schema.sql",
  plugin: "react-doctor",
  rule: "supabase-missing-rls",
  severity: "warning",
  title: "Enable row level security",
  message: "Enable RLS.",
  help: "Protect the table.",
  line: 1,
  column: 1,
  category: "Security",
};
const success = (id: number, diagnostics: Diagnostic[] = [], didReachDeadline = false) => ({
  type: "result",
  id,
  ok: true,
  diagnostics,
  didReachDeadline,
});
const workers: SecurityScanWorker[] = [];
const makeWorker = (child = new FakeSecurityChild()) => {
  const createChild = vi.fn(() => child);
  const worker = createSecurityScanWorker({ createChild });
  workers.push(worker);
  return { child, createChild, worker };
};

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.dispose()));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("security scan worker", () => {
  it("stays lazy and disposes idempotently before its first job", async () => {
    const { worker, createChild } = makeWorker();
    expect(createChild).not.toHaveBeenCalled();
    const disposal = worker.dispose();
    expect(worker.dispose()).toBe(disposal);
    await disposal;
    await expect(worker.run("unused")).rejects.toThrow("disposed");
    expect(createChild).not.toHaveBeenCalled();
  });

  it("snapshots invocation environment and queued options, and runs FIFO on one child", async () => {
    vi.stubEnv("REACT_DOCTOR_WORKER_TEST", "initial");
    const { worker, child, createChild } = makeWorker();
    vi.stubEnv("REACT_DOCTOR_WORKER_TEST", "later");
    const ignoredTags = new Set(["security"]);
    const run = worker.run;
    const first = run("first", { ignoredTags });
    const second = run("second");
    ignoredTags.clear();
    expect(child.messages).toEqual([]);
    child.emit("message", { type: "ready" });
    expect(child.messages).toEqual([
      expect.objectContaining({
        id: 1,
        rootDirectory: "first",
        options: expect.objectContaining({ ignoredTags: ["security"] }),
      }),
    ]);
    child.emit("message", success(1, [diagnostic]));
    await expect(first).resolves.toEqual([diagnostic]);
    expect(child.messages).toHaveLength(2);
    child.emit("message", success(2));
    await expect(second).resolves.toEqual([]);
    expect(createChild).toHaveBeenCalledOnce();
    expect(createChild).toHaveBeenCalledWith(
      expect.stringContaining("security-scan-worker.js"),
      expect.objectContaining({
        serialization: "advanced",
        cwd: process.cwd(),
        env: expect.objectContaining({ REACT_DOCTOR_WORKER_TEST: "initial" }),
      }),
    );
  });

  it("preserves already-aborted and queued null reasons without dispatching them", async () => {
    const { worker, child, createChild } = makeWorker();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort(null);
    await expect(worker.run("before", { signal: alreadyAborted.signal })).rejects.toBe(null);
    expect(createChild).not.toHaveBeenCalled();
    const controller = new AbortController();
    const queued = worker.run("queued", { signal: controller.signal });
    const rejected = expect(queued).rejects.toBe(null);
    controller.abort(null);
    await rejected;
    child.emit("message", { type: "ready" });
    expect(child.messages).toEqual([]);
  });

  it("retains an aborted active slot until its reply and preserves its sibling", async () => {
    const { worker, child } = makeWorker();
    const controller = new AbortController();
    const onDeadlineExceeded = vi.fn();
    const first = worker.run("first", { signal: controller.signal, onDeadlineExceeded });
    const rejected = expect(first).rejects.toBe(null);
    const second = worker.run("second");
    child.emit("message", { type: "ready" });
    controller.abort(null);
    await rejected;
    expect(child.messages).toEqual([
      expect.objectContaining({ type: "scan", id: 1 }),
      { type: "abort", id: 1 },
    ]);
    child.emit("message", success(1, [diagnostic], true));
    expect(onDeadlineExceeded).not.toHaveBeenCalled();
    expect(child.messages.at(-1)).toEqual(expect.objectContaining({ type: "scan", id: 2 }));
    child.emit("message", success(2, [diagnostic]));
    await expect(second).resolves.toEqual([diagnostic]);
  });

  it("checks abort state before a result delivered by an earlier abort listener", async () => {
    const { worker, child } = makeWorker();
    const controller = new AbortController();
    const onDeadlineExceeded = vi.fn();
    controller.signal.addEventListener("abort", () => child.emit("message", success(1, [], true)));
    const result = worker.run("first", { signal: controller.signal, onDeadlineExceeded });
    const rejected = expect(result).rejects.toBe(null);
    child.emit("message", { type: "ready" });
    controller.abort(null);
    await rejected;
    expect(onDeadlineExceeded).not.toHaveBeenCalled();
  });

  it("returns partial findings and invokes the deadline callback exactly once", async () => {
    const { worker, child } = makeWorker();
    const onDeadlineExceeded = vi.fn();
    const result = worker.run("partial", { onDeadlineExceeded });
    child.emit("message", { type: "ready" });
    child.emit("message", success(1, [diagnostic], true));
    await expect(result).resolves.toEqual([diagnostic]);
    expect(onDeadlineExceeded).toHaveBeenCalledOnce();
  });

  it("preserves callback-triggered null aborts and callback errors without poisoning siblings", async () => {
    const { worker, child } = makeWorker();
    const controller = new AbortController();
    const first = worker.run("first", {
      signal: controller.signal,
      onDeadlineExceeded: () => controller.abort(null),
    });
    const firstRejected = expect(first).rejects.toBe(null);
    const callbackError = new Error("callback failed");
    const second = worker.run("second", {
      onDeadlineExceeded: () => {
        throw callbackError;
      },
    });
    const secondRejected = expect(second).rejects.toBe(callbackError);
    const third = worker.run("third");
    child.emit("message", { type: "ready" });
    child.emit("message", success(1, [], true));
    child.emit("message", success(2, [], true));
    child.emit("message", success(3));
    await firstRejected;
    await secondRejected;
    await expect(third).resolves.toEqual([]);
  });

  it.each(["malformed", "unexpected-id", "duplicate-ready", "disconnect", "exit", "send"])(
    "fails closed after %s without restarting",
    async (failureMode) => {
      const { worker, child, createChild } = makeWorker();
      const first = worker.run("first");
      const second = worker.run("second");
      const rejected = Promise.all([
        expect(first).rejects.toBeInstanceOf(Error),
        expect(second).rejects.toBeInstanceOf(Error),
      ]);
      if (failureMode === "send") child.sendError = new Error("send failed");
      child.emit("message", { type: "ready" });
      if (failureMode === "malformed")
        child.emit("message", success(1, [{ ...diagnostic, line: Number.NaN }]));
      if (failureMode === "unexpected-id") child.emit("message", success(2));
      if (failureMode === "duplicate-ready") child.emit("message", { type: "ready" });
      if (failureMode === "disconnect") child.disconnect();
      if (failureMode === "exit") child.emit("close", 1, null);
      await rejected;
      await expect(worker.run("later")).rejects.toBeInstanceOf(Error);
      expect(createChild).toHaveBeenCalledOnce();
    },
  );

  it("bounds startup and cleanup even if killing the owned child throws", async () => {
    vi.useFakeTimers();
    const exitListeners = process.listenerCount("exit");
    const { worker, child } = makeWorker();
    child.closeOnDisconnect = false;
    const kill = vi.spyOn(child, "kill").mockImplementation(() => {
      throw new Error("already gone");
    });
    const result = worker.run("first");
    const rejected = expect(result).rejects.toThrow("initialization timed out");
    await vi.advanceTimersByTimeAsync(SECURITY_SCAN_WORKER_STARTUP_TIMEOUT_MS);
    await rejected;
    const disposal = worker.dispose();
    expect(worker.dispose()).toBe(disposal);
    await vi.advanceTimersByTimeAsync(
      SECURITY_SCAN_WORKER_SHUTDOWN_GRACE_MS + SECURITY_SCAN_WORKER_KILL_TIMEOUT_MS,
    );
    await expect(disposal).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledOnce();
    expect(process.listenerCount("exit")).toBe(exitListeners + 1);
    child.emit("close", 0, null);
    expect(process.listenerCount("exit")).toBe(exitListeners);
  });

  it("rejects active and queued jobs when disposed and bounds a child that never closes", async () => {
    vi.useFakeTimers();
    const { worker, child } = makeWorker();
    child.closeOnDisconnect = false;
    child.closeOnKill = false;
    const kill = vi.spyOn(child, "kill");
    const first = worker.run("active");
    const second = worker.run("queued");
    const rejected = Promise.all([
      expect(first).rejects.toThrow("disposed"),
      expect(second).rejects.toThrow("disposed"),
    ]);
    child.emit("message", { type: "ready" });
    const disposal = worker.dispose();
    await rejected;
    child.emit("message", success(1));
    expect(child.messages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(
      SECURITY_SCAN_WORKER_SHUTDOWN_GRACE_MS + SECURITY_SCAN_WORKER_KILL_TIMEOUT_MS,
    );
    await expect(disposal).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledOnce();
    child.emit("close", 0, null);
  });

  it("rejects a startup error and keeps the owner failed", async () => {
    const { worker, child, createChild } = makeWorker();
    const error = new Error("spawn failed");
    const result = worker.run("first");
    const rejected = expect(result).rejects.toBe(error);
    child.emit("error", error);
    await rejected;
    await expect(worker.run("later")).rejects.toBe(error);
    expect(createChild).toHaveBeenCalledOnce();
  });

  it("rejects metadata that advanced IPC would silently discard", () => {
    const symbolDiagnostic = { ...diagnostic, [Symbol.for("react-doctor.test")]: "identity" };
    expect(() => parseSecurityScanWorkerResult(success(1, [symbolDiagnostic]))).toThrow(
      "invalid result",
    );
    expect(() =>
      parseSecurityScanWorkerResult(success(1, [{ ...diagnostic, extra: true }])),
    ).toThrow("invalid result");
  });

  it("runs the actual child entry repeatedly with canonical results and graceful disposal", async () => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV, undefined);
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, undefined);
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-security-worker-"));
    const require = createRequire(
      path.resolve(import.meta.dirname, "../../../security-worker-test.cjs"),
    );
    const loader = pathToFileURL(require.resolve("tsx")).href;
    let actualChild: ChildProcess | undefined;
    const worker = createSecurityScanWorker({
      createChild: (_workerPath, options) => {
        actualChild = spawn(
          process.execPath,
          ["--import", loader, path.resolve(import.meta.dirname, "../src/security-scan-worker.ts")],
          options,
        );
        return actualChild;
      },
    });
    workers.push(worker);
    try {
      fs.mkdirSync(path.join(temporaryRoot, "supabase/migrations"), { recursive: true });
      fs.writeFileSync(
        path.join(temporaryRoot, "supabase/migrations/schema.sql"),
        "create table public.profiles (id uuid primary key, email text);\n",
      );
      const canonical = await checkSecurityScanCooperative(temporaryRoot);
      expect(canonical.length).toBeGreaterThan(0);
      await expect(worker.run(temporaryRoot)).resolves.toEqual(canonical);
      const onDeadlineExceeded = vi.fn();
      await expect(
        worker.run(temporaryRoot, { deadlineEpochMs: 0, onDeadlineExceeded }),
      ).resolves.toEqual([]);
      expect(onDeadlineExceeded).toHaveBeenCalledOnce();
      const disabledDeadline = vi.fn();
      await expect(
        worker.run(temporaryRoot, {
          ignoredTags: new Set(["security-scan"]),
          deadlineEpochMs: 0,
          onDeadlineExceeded: disabledDeadline,
        }),
      ).resolves.toEqual([]);
      expect(disabledDeadline).not.toHaveBeenCalled();
      await expect(worker.run(temporaryRoot)).resolves.toEqual(canonical);
      if (actualChild === undefined) throw new Error("Worker did not spawn.");
      const kill = vi.spyOn(actualChild, "kill");
      await worker.dispose();
      expect(kill).not.toHaveBeenCalled();
      expect(actualChild.exitCode).toBe(0);
    } finally {
      await worker.dispose();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
