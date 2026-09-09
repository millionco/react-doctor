import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { OXLINT_WORKER_JOB_END_MARKER } from "../src/constants.js";
import { isReactDoctorError } from "../src/errors.js";
import {
  createOxlintWorkerPool,
  OxlintWorkerUnavailableError,
} from "../src/runners/oxlint/oxlint-worker-pool.js";
import type { OxlintWorkerPool } from "../src/runners/oxlint/oxlint-worker-pool.js";

// Speaks the worker protocol without oxlint: the first argument selects the
// behavior so each test can drive one failure mode.
const FAKE_WORKER_SOURCE = `
import * as fs from "node:fs";
const MARKER = ${JSON.stringify(OXLINT_WORKER_JOB_END_MARKER)};
const writeLine = (fd, line) => fs.writeSync(fd, "\\n" + line + "\\n");
if (process.env.FAKE_WORKER_UNAVAILABLE) {
  process.send({ type: "unavailable", message: "internals missing" });
} else {
  process.send({ type: "ready" });
}
process.on("message", (job) => {
  if (job.type !== "job") return;
  const [mode, ...rest] = job.argumentsList;
  process.chdir(job.cwd);
  if (mode === "crash") {
    // HACK: process.abort() on Windows hands the process to Windows Error
    // Reporting, which can stall it past the job timeout, so the abort exit
    // code is emulated there instead.
    if (process.platform === "win32") process.exit(134);
    process.abort();
  }
  if (mode === "hang") return;
  if (mode === "stderr-only") {
    fs.writeSync(2, "Failed to find tsgolint executable");
    writeLine(1, MARKER + ":" + job.id + ":findings");
    writeLine(2, MARKER + ":" + job.id + ":end");
    return;
  }
  if (mode === "throw") {
    fs.writeSync(2, "lint rejected");
    writeLine(1, MARKER + ":" + job.id + ":error");
    writeLine(2, MARKER + ":" + job.id + ":end");
    return;
  }
  const payload = JSON.stringify({
    pid: process.pid,
    cwd: process.cwd(),
    rest,
    id: job.id,
    filesystemCacheEpoch: job.filesystemCacheEpoch,
  });
  fs.writeSync(1, mode === "big" ? payload + "x".repeat(4096) : payload);
  if (mode === "warn") fs.writeSync(2, "some warning");
  writeLine(1, MARKER + ":" + job.id + ":findings");
  writeLine(2, MARKER + ":" + job.id + ":end");
});
`;

interface FakeWorkerOutput {
  readonly pid: number;
  readonly cwd: string;
  readonly rest: string[];
  readonly id: number;
  readonly filesystemCacheEpoch: number | null;
}

// Killed workers on Windows keep their cwd locked until the OS reaps them.
const TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES = 10;

const parseOutput = (stdout: string): FakeWorkerOutput => JSON.parse(stdout) as FakeWorkerOutput;

const readReasonTag = (error: unknown): string | null =>
  isReactDoctorError(error) ? error.reason._tag : null;

describe("createOxlintWorkerPool", () => {
  let temporaryDirectory = "";
  let workerScriptPath = "";
  let jobDirectoryA = "";
  let jobDirectoryB = "";
  const pools: OxlintWorkerPool[] = [];

  const createPool = (
    overrides: Partial<Parameters<typeof createOxlintWorkerPool>[0]> = {},
  ): OxlintWorkerPool => {
    const pool = createOxlintWorkerPool({
      nodeBinaryPath: process.execPath,
      workerScriptPath,
      oxlintPackageDirectory: temporaryDirectory,
      maxWorkers: 2,
      environment: { ...process.env },
      ...overrides,
    });
    pools.push(pool);
    return pool;
  };

  const runJob = (
    pool: OxlintWorkerPool,
    argumentsList: string[],
    cwd: string = jobDirectoryA,
    extra: {
      outputMaxBytes?: number;
      timeoutMs?: number;
      abortSignal?: AbortSignal;
      filesystemCacheEpoch?: number | null;
    } = {},
  ): Promise<string> =>
    pool.run({
      argumentsList,
      cwd,
      timeoutMs: extra.timeoutMs ?? 10_000,
      outputMaxBytes: extra.outputMaxBytes ?? 1_000_000,
      filesystemCacheEpoch: extra.filesystemCacheEpoch ?? null,
      abortSignal: extra.abortSignal,
    });

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxlint-pool-"));
    workerScriptPath = path.join(temporaryDirectory, "fake-oxlint-worker.mjs");
    fs.writeFileSync(workerScriptPath, FAKE_WORKER_SOURCE);
    jobDirectoryA = path.join(temporaryDirectory, "project-a");
    jobDirectoryB = path.join(temporaryDirectory, "project-b");
    fs.mkdirSync(jobDirectoryA);
    fs.mkdirSync(jobDirectoryB);
  });

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.close()));
    fs.rmSync(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES,
    });
  });

  it("reuses one worker for sequential jobs and applies the per-job cwd", async () => {
    const pool = createPool({ maxWorkers: 1 });
    const first = parseOutput(await runJob(pool, ["echo", "a"], jobDirectoryA));
    const second = parseOutput(await runJob(pool, ["echo", "b"], jobDirectoryB));

    expect(first.pid).toBe(second.pid);
    expect(first.rest).toEqual(["a"]);
    expect(second.rest).toEqual(["b"]);
    expect(fs.realpathSync(first.cwd)).toBe(fs.realpathSync(jobDirectoryA));
    expect(fs.realpathSync(second.cwd)).toBe(fs.realpathSync(jobDirectoryB));
    expect(pool.workerCount()).toBe(1);
  });

  it("forwards the filesystem cache epoch to the worker", async () => {
    const pool = createPool({ maxWorkers: 1 });
    const withEpoch = parseOutput(
      await runJob(pool, ["echo"], jobDirectoryA, { filesystemCacheEpoch: 7 }),
    );
    const withoutEpoch = parseOutput(await runJob(pool, ["echo"], jobDirectoryA));

    expect(withEpoch.filesystemCacheEpoch).toBe(7);
    expect(withoutEpoch.filesystemCacheEpoch).toBeNull();
  });

  it("caps concurrent workers at maxWorkers and queues the rest", async () => {
    const pool = createPool({ maxWorkers: 2 });
    const outputs = await Promise.all(
      Array.from({ length: 6 }, (_, index) => runJob(pool, ["echo", String(index)])),
    );
    const pids = new Set(outputs.map((stdout) => parseOutput(stdout).pid));

    expect(pids.size).toBeLessThanOrEqual(2);
    expect(pool.workerCount()).toBeLessThanOrEqual(2);
    expect(outputs.map((stdout) => parseOutput(stdout).rest[0])).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("warm boots idle workers up to maxWorkers and later jobs reuse them", async () => {
    const pool = createPool({ maxWorkers: 2 });
    pool.warm();
    pool.warm();
    expect(pool.workerCount()).toBe(2);

    const outputs = await Promise.all(
      Array.from({ length: 4 }, (_, index) => runJob(pool, ["echo", String(index)])),
    );
    const pids = new Set(outputs.map((stdout) => parseOutput(stdout).pid));

    expect(pids.size).toBe(2);
    expect(pool.workerCount()).toBe(2);
  });

  it("warm is a no-op once the pool is unavailable", async () => {
    const pool = createPool({ environment: { ...process.env, FAKE_WORKER_UNAVAILABLE: "1" } });
    await expect(runJob(pool, ["echo"])).rejects.toBeInstanceOf(OxlintWorkerUnavailableError);
    const workerCountBeforeWarm = pool.workerCount();
    pool.warm();
    expect(pool.isAvailable()).toBe(false);
    expect(pool.workerCount()).toBe(workerCountBeforeWarm);
  });

  it("strips the end markers and keeps stdout when the job also wrote to stderr", async () => {
    const pool = createPool();
    const stdout = await runJob(pool, ["warn"]);

    expect(stdout).not.toContain(OXLINT_WORKER_JOB_END_MARKER);
    expect(parseOutput(stdout).rest).toEqual([]);
  });

  it("reports stderr-only output as OxlintSpawnFailed so the extends-stripped retry triggers", async () => {
    const pool = createPool();
    const error: unknown = await runJob(pool, ["stderr-only"]).catch((caught: unknown) => caught);

    expect(readReasonTag(error)).toBe("OxlintSpawnFailed");
    expect(String(error)).toContain("Failed to find tsgolint executable");
  });

  it("reports a rejected lint() as OxlintSpawnFailed", async () => {
    const pool = createPool();
    const error: unknown = await runJob(pool, ["throw"]).catch((caught: unknown) => caught);

    expect(readReasonTag(error)).toBe("OxlintSpawnFailed");
    expect(String(error)).toContain("lint rejected");
  });

  it("maps a worker SIGABRT to an OOM batch error and keeps serving later jobs", async () => {
    const pool = createPool({ maxWorkers: 1 });
    const error: unknown = await runJob(pool, ["crash"]).catch((caught: unknown) => caught);

    expect(readReasonTag(error)).toBe("OxlintBatchExceeded");
    expect(String(error)).toMatch(/killed by SIGABRT|aborted with exit code 134/);
    expect(pool.isAvailable()).toBe(true);
    expect(parseOutput(await runJob(pool, ["echo", "after"])).rest).toEqual(["after"]);
  });

  it("does not lose sibling jobs when one worker crashes", async () => {
    const pool = createPool({ maxWorkers: 2 });
    const results = await Promise.allSettled([
      runJob(pool, ["crash"]),
      runJob(pool, ["echo", "1"]),
      runJob(pool, ["echo", "2"]),
      runJob(pool, ["echo", "3"]),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");

    expect(results[0]?.status).toBe("rejected");
    expect(fulfilled).toHaveLength(3);
  });

  it("enforces the per-job timeout and replaces the hung worker", async () => {
    const pool = createPool({ maxWorkers: 1 });
    const error: unknown = await runJob(pool, ["hang"], jobDirectoryA, { timeoutMs: 200 }).catch(
      (caught: unknown) => caught,
    );

    expect(readReasonTag(error)).toBe("OxlintBatchExceeded");
    expect(String(error)).toContain("budget exceeded");
    expect(parseOutput(await runJob(pool, ["echo", "next"])).rest).toEqual(["next"]);
  });

  it("keeps the pool available when a job times out before its worker is ready", async () => {
    const pool = createPool({ maxWorkers: 1 });
    const error: unknown = await runJob(pool, ["hang"], jobDirectoryA, { timeoutMs: 1 }).catch(
      (caught: unknown) => caught,
    );

    expect(readReasonTag(error)).toBe("OxlintBatchExceeded");
    expect(pool.isAvailable()).toBe(true);
    expect(parseOutput(await runJob(pool, ["echo", "next"])).rest).toEqual(["next"]);
  });

  it("enforces the output ceiling", async () => {
    const pool = createPool();
    const error: unknown = await runJob(pool, ["big"], jobDirectoryA, {
      outputMaxBytes: 1_024,
    }).catch((caught: unknown) => caught);

    expect(readReasonTag(error)).toBe("OxlintBatchExceeded");
    expect(String(error)).toContain("exceeded 1024 bytes");
  });

  it("aborts queued and in-flight jobs when the lint phase is aborted", async () => {
    const pool = createPool({ maxWorkers: 1 });
    const controller = new AbortController();
    const inFlight = runJob(pool, ["hang"], jobDirectoryA, { abortSignal: controller.signal });
    const queued = runJob(pool, ["echo", "queued"], jobDirectoryA, {
      abortSignal: controller.signal,
    });
    controller.abort();
    const results = await Promise.allSettled([inFlight, queued]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    for (const result of results) {
      if (result.status === "rejected")
        expect(readReasonTag(result.reason)).toBe("OxlintSpawnFailed");
    }
  });

  it("raises OxlintWorkerUnavailableError when the worker cannot boot", async () => {
    const pool = createPool({ environment: { ...process.env, FAKE_WORKER_UNAVAILABLE: "1" } });
    const error: unknown = await runJob(pool, ["echo"]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OxlintWorkerUnavailableError);
    expect(pool.isAvailable()).toBe(false);
    await expect(runJob(pool, ["echo"])).rejects.toBeInstanceOf(OxlintWorkerUnavailableError);
  });

  it("raises OxlintWorkerUnavailableError when the worker script is missing", async () => {
    const pool = createPool({ workerScriptPath: path.join(temporaryDirectory, "missing.mjs") });
    const error: unknown = await runJob(pool, ["echo"]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OxlintWorkerUnavailableError);
  });
});
