import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { createPersistentOxlintWorkerPool } from "../src/runners/oxlint/create-persistent-oxlint-worker-pool.js";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { resolveOxlintBinary, resolvePluginPath } from "../src/runners/oxlint/resolve-paths.js";
import { spawnLintBatches } from "../src/runners/oxlint/spawn-batches.js";

const temporaryDirectories: string[] = [];

const project: ProjectInfo = {
  rootDirectory: "",
  projectName: "persistent-worker-test",
  reactVersion: null,
  reactMajorVersion: null,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 1,
};

const createFixture = (): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-persistent-worker-"));
  temporaryDirectories.push(rootDirectory);
  fs.mkdirSync(path.join(rootDirectory, "src"));
  fs.writeFileSync(path.join(rootDirectory, "src", "file.ts"), "debugger;\n");
  return rootDirectory;
};

const persistentWorkerScriptPath = path.join(
  import.meta.dirname,
  "fixtures",
  "persistent-oxlint-worker.mjs",
);
const crashWorkerScriptPath = path.join(
  import.meta.dirname,
  "fixtures",
  "persistent-oxlint-crash-worker.mjs",
);
const oxlintBinaryPath = resolveOxlintBinary();
const TEST_TIMEOUT_MS = 50;
const TEST_OUTPUT_MAX_BYTES = 16;
const TEST_EXCESS_OUTPUT_BYTES = 64;

const normalizeOxlintOutput = (output: string): object => {
  const parsedOutput: unknown = JSON.parse(output);
  if (typeof parsedOutput !== "object" || parsedOutput === null) {
    throw new Error("oxlint returned a non-object result");
  }
  return Object.fromEntries(
    Object.entries(parsedOutput).filter(([propertyName]) => propertyName !== "start_time"),
  );
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("persistent oxlint worker pool prototype", () => {
  it("matches the production subprocess runner's diagnostic shape and order", async () => {
    const rootDirectory = createFixture();
    const input = {
      baseArgs: [oxlintBinaryPath, "--format", "json", "--deny", "no-debugger"],
      fileBatches: [["src/file.ts"]],
      rootDirectory,
      nodeBinaryPath: process.execPath,
      project: { ...project, rootDirectory },
    };
    const productionDiagnostics = await spawnLintBatches(input);
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: persistentWorkerScriptPath,
    });
    try {
      const persistentDiagnostics = await spawnLintBatches({
        ...input,
        batchRunner: pool,
      });
      expect(persistentDiagnostics).toEqual(productionDiagnostics);
    } finally {
      await pool.close();
    }
  });

  it("reuses one initialized worker for sequential batches", async () => {
    const rootDirectory = createFixture();
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: persistentWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const run = () =>
      pool.run({
        args: [oxlintBinaryPath, "--format", "json", "--deny", "no-debugger", "src/file.ts"],
        rootDirectory,
        nodeBinaryPath: process.execPath,
      });
    try {
      await run();
      await run();
      expect(processIds).toHaveLength(1);
    } finally {
      await pool.close();
    }
  });

  it("resets the fixture-only rule table between real plugin runs", async () => {
    const rootDirectory = createFixture();
    fs.writeFileSync(
      path.join(rootDirectory, "src", "file.ts"),
      "export const runCode = (sourceText: string) => eval(sourceText);\n",
    );
    const configPath = path.join(rootDirectory, "oxlintrc.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        categories: {
          correctness: "off",
          suspicious: "off",
          pedantic: "off",
          perf: "off",
          restriction: "off",
          style: "off",
          nursery: "off",
        },
        plugins: [],
        jsPlugins: [resolvePluginPath()],
        settings: {
          "react-doctor": {
            capabilities: [],
            framework: "unknown",
            rootDirectory,
          },
        },
        rules: { "react-doctor/no-eval": "error" },
      }),
    );
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: persistentWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const run = () =>
      pool.run({
        args: [
          oxlintBinaryPath,
          "-c",
          configPath,
          "--threads=1",
          "--disable-nested-config",
          "--format",
          "json",
          "src/file.ts",
        ],
        rootDirectory,
        nodeBinaryPath: process.execPath,
      });
    try {
      const firstOutput = await run();
      const secondOutput = await run();
      const firstDiagnostics = parseOxlintOutput(
        firstOutput,
        { ...project, rootDirectory },
        rootDirectory,
      );
      const secondDiagnostics = parseOxlintOutput(
        secondOutput,
        { ...project, rootDirectory },
        rootDirectory,
      );

      expect(normalizeOxlintOutput(secondOutput)).toEqual(normalizeOxlintOutput(firstOutput));
      expect(secondDiagnostics).toEqual(firstDiagnostics);
      expect(firstDiagnostics).toMatchObject([
        {
          filePath: path.join("src", "file.ts"),
          plugin: "react-doctor",
          rule: "no-eval",
          severity: "error",
          line: 1,
        },
      ]);
      expect(processIds).toHaveLength(1);
    } finally {
      await pool.close();
    }
  });

  it("keeps back-to-back response frames isolated", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    try {
      const [firstOutput, secondOutput] = await Promise.all([
        pool.run({
          args: ["--first"],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
        }),
        pool.run({
          args: ["--second"],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
        }),
      ]);
      expect(firstOutput).toBe(JSON.stringify({ diagnostics: [], args: ["--first"] }));
      expect(secondOutput).toBe(JSON.stringify({ diagnostics: [], args: ["--second"] }));
      expect(processIds).toHaveLength(1);
    } finally {
      await pool.close();
    }
  });

  it("rotates a worker after the configured run threshold", async () => {
    const rootDirectory = createFixture();
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: persistentWorkerScriptPath,
      maxRunsPerWorker: 1,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const run = () =>
      pool.run({
        args: [oxlintBinaryPath, "--format", "json", "--deny", "no-debugger", "src/file.ts"],
        rootDirectory,
        nodeBinaryPath: process.execPath,
      });
    try {
      await run();
      await run();
      expect(processIds).toHaveLength(2);
      expect(processIds[0]).not.toBe(processIds[1]);
    } finally {
      await pool.close();
    }
  });

  it("classifies a worker crash and replaces it for the next batch", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const run = (args: ReadonlyArray<string>) =>
      pool.run({
        args,
        rootDirectory: process.cwd(),
        nodeBinaryPath: process.execPath,
      });
    try {
      await expect(run(["--crash"])).rejects.toMatchObject({
        reason: { _tag: "OxlintBatchExceeded", kind: "oom" },
      });
      await expect(run(["--healthy"])).resolves.toContain('"--healthy"');
      expect(processIds).toHaveLength(2);
    } finally {
      await pool.close();
    }
  });

  it("terminates a timed-out worker and replaces it for the next batch", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const run = (args: ReadonlyArray<string>, spawnTimeoutMs?: number) =>
      pool.run({
        args,
        rootDirectory: process.cwd(),
        nodeBinaryPath: process.execPath,
        spawnTimeoutMs,
      });
    try {
      await expect(run(["--hang"], TEST_TIMEOUT_MS)).rejects.toMatchObject({
        reason: { _tag: "OxlintBatchExceeded", kind: "timeout" },
      });
      await expect(run(["--healthy"])).resolves.toContain('"--healthy"');
      expect(processIds).toHaveLength(2);
    } finally {
      await pool.close();
    }
  });

  it("terminates an aborted worker and replaces it for the next batch", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const abortController = new AbortController();
    const pendingRun = pool.run({
      args: ["--hang"],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
      abortSignal: abortController.signal,
    });
    while (processIds.length === 0) await Promise.resolve();
    abortController.abort();
    try {
      await expect(pendingRun).rejects.toMatchObject({
        reason: { _tag: "OxlintSpawnFailed" },
      });
      await expect(
        pool.run({
          args: ["--healthy"],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
        }),
      ).resolves.toContain('"--healthy"');
      expect(processIds).toHaveLength(2);
    } finally {
      await pool.close();
    }
  });

  it("terminates a worker that exceeds the output ceiling and replaces it", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    try {
      await expect(
        pool.run({
          args: [`--output-bytes=${TEST_EXCESS_OUTPUT_BYTES}`],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
          outputMaxBytes: TEST_OUTPUT_MAX_BYTES,
        }),
      ).rejects.toMatchObject({
        reason: { _tag: "OxlintBatchExceeded", kind: "output-too-large" },
      });
      await expect(
        pool.run({
          args: ["--healthy"],
          rootDirectory: process.cwd(),
          nodeBinaryPath: process.execPath,
        }),
      ).resolves.toContain('"--healthy"');
      expect(processIds).toHaveLength(2);
    } finally {
      await pool.close();
    }
  });

  it("waits for every worker process to exit when closed", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    await pool.run({
      args: ["--healthy"],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
    });
    await pool.close();
    const processId = processIds[0];
    if (processId === undefined) throw new Error("worker process did not start");
    expect(() => process.kill(processId, 0)).toThrow();
  });

  it("settles active work before close resolves", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const pendingRun = pool.run({
      args: ["--hang"],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
    });
    while (processIds.length === 0) await Promise.resolve();

    const [runResult, closeResult] = await Promise.allSettled([pendingRun, pool.close()]);

    expect(runResult.status).toBe("rejected");
    expect(closeResult.status).toBe("fulfilled");
    const processId = processIds[0];
    if (processId === undefined) throw new Error("worker process did not start");
    expect(() => process.kill(processId, 0)).toThrow();
  });

  it("settles queued work before close resolves", async () => {
    const processIds: Array<number | undefined> = [];
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: crashWorkerScriptPath,
      onWorkerSpawn: (processId) => processIds.push(processId),
    });
    const activeRun = pool.run({
      args: ["--hang"],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
    });
    const queuedRun = pool.run({
      args: ["--queued"],
      rootDirectory: process.cwd(),
      nodeBinaryPath: process.execPath,
    });
    while (processIds.length === 0) await Promise.resolve();

    const [activeResult, queuedResult, closeResult] = await Promise.allSettled([
      activeRun,
      queuedRun,
      pool.close(),
    ]);

    expect(activeResult.status).toBe("rejected");
    expect(queuedResult.status).toBe("rejected");
    expect(closeResult.status).toBe("fulfilled");
    expect(processIds).toHaveLength(1);
    const processId = processIds[0];
    if (processId === undefined) throw new Error("worker process did not start");
    expect(() => process.kill(processId, 0)).toThrow();
  });

  it("keeps the production runner as the default rollback path", async () => {
    const rootDirectory = createFixture();
    let poolSpawnCount = 0;
    const pool = createPersistentOxlintWorkerPool({
      workerCount: 1,
      nodeBinaryPath: process.execPath,
      workerScriptPath: persistentWorkerScriptPath,
      onWorkerSpawn: () => {
        poolSpawnCount += 1;
      },
    });
    try {
      const diagnostics = await spawnLintBatches({
        baseArgs: [oxlintBinaryPath, "--format", "json", "--deny", "no-debugger"],
        fileBatches: [["src/file.ts"]],
        rootDirectory,
        nodeBinaryPath: process.execPath,
        project: { ...project, rootDirectory },
      });
      expect(diagnostics).toHaveLength(1);
      expect(poolSpawnCount).toBe(0);
    } finally {
      await pool.close();
    }
  });
});
