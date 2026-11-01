import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticIdentity, runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject, writeFile } from "../regressions/_helpers.js";

import { createOxlintSpawnSlots } from "../../../core/src/utils/create-oxlint-spawn-slots.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((...argumentsList: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...argumentsList);
      if (child.send) vi.spyOn(child, "send");
      return child;
    }),
  };
});

const PROP_TYPES_SCAN_CONCURRENCY = 1;

interface FixtureWorkerObserver {
  readonly startPhase: () => void;
  readonly assertEpoch: (epoch: number) => void;
}

const observeFixtureWorker = (directory: string): FixtureWorkerObserver => {
  let selectedWorker: ChildProcess | undefined;
  let selectedPid: number | undefined;
  const observedEpochs = new Set<number>();
  let phaseNumber = 0;
  const assertEpoch = (epoch: number): void => {
    const workers = vi.mocked(spawn).mock.results.flatMap((result) => {
      if (result.type !== "return" || !result.value.send || !vi.isMockFunction(result.value.send))
        return [];
      const belongsToFixture = vi
        .mocked(result.value.send)
        .mock.calls.some(
          ([message]) =>
            typeof message === "object" &&
            message !== null &&
            "cwd" in message &&
            message.cwd === directory &&
            "type" in message &&
            (message.type === "job" || message.type === "probes"),
        );
      return belongsToFixture ? [result.value] : [];
    });
    expect(workers).toHaveLength(PROP_TYPES_SCAN_CONCURRENCY);
    const worker = workers[0];
    if (!selectedWorker) {
      selectedWorker = worker;
      selectedPid = worker?.pid;
    }
    expect(workers).toEqual([selectedWorker]);
    expect(worker?.pid).toBeGreaterThan(0);
    expect(worker?.pid).toBe(selectedPid);
    expect(worker?.connected).toBe(true);
    expect(worker?.exitCode).toBeNull();
    expect(worker?.signalCode).toBeNull();
    const sentEpochs =
      worker?.send &&
      vi
        .mocked(worker.send)
        .mock.calls.flatMap(([message]) =>
          typeof message === "object" &&
          message !== null &&
          "cwd" in message &&
          message.cwd === directory &&
          "type" in message &&
          (message.type === "job" || message.type === "probes") &&
          "filesystemCacheEpoch" in message &&
          typeof message.filesystemCacheEpoch === "number"
            ? [message.filesystemCacheEpoch]
            : [],
        );
    expect(sentEpochs).toContain(epoch);
    expect(observedEpochs.has(epoch)).toBe(false);
    observedEpochs.add(epoch);
  };
  return {
    assertEpoch,
    startPhase: () => {
      phaseNumber += 1;
      writeFile(
        path.join(directory, "src/worker-epoch-pulse.ts"),
        `export const phaseMarker = ${phaseNumber};\n`,
      );
    },
  };
};

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prop-types-sidecar-"));
const source =
  'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};';
const preservedTimestamp = new Date("2025-01-01T00:00:00.000Z");
afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const createFixture = (name: string): string => {
  const directory = setupReactProject(temporaryDirectory, name, {
    files: { "src/Panel.tsx": source },
  });
  fs.mkdirSync(path.join(directory, "node_modules"), { recursive: true });
  return directory;
};

const scan = async (
  directory: string,
  useCaches: boolean,
  assertWorker: (epoch: number) => void,
): Promise<Diagnostic[]> => {
  const failures: string[] = [];
  const spawnSlots = createOxlintSpawnSlots(PROP_TYPES_SCAN_CONCURRENCY);
  const diagnostics = await runOxlint({
    rootDirectory: directory,
    nodeBinaryPath: process.execPath,
    concurrency: PROP_TYPES_SCAN_CONCURRENCY,
    spawnSlots,
    project: buildTestProject({ rootDirectory: directory, framework: "vite" }),
    customRulesOnly: true,
    userConfig: { rules: { "react-doctor/hook-use-state": "warn" } },
    perFileLintCacheEnabled: useCaches,
    sidecarLintCacheEnabled: useCaches,
    onPartialFailure: (reason) => failures.push(reason),
  });
  expect(failures).toEqual([]);
  assertWorker(spawnSlots.filesystemCacheEpoch);
  return diagnostics;
};

const expectCurrentVerdict = async (
  directory: string,
  expectedCount: number,
  workerObserver: FixtureWorkerObserver,
): Promise<void> => {
  workerObserver.startPhase();
  const incremental = await scan(directory, true, workerObserver.assertEpoch);
  const full = await scan(directory, false, workerObserver.assertEpoch);
  expect(fs.readFileSync(path.join(directory, "src/Panel.tsx"), "utf8")).toBe(source);
  const byIdentity = (first: Diagnostic, second: Diagnostic): number =>
    buildDiagnosticIdentity(first).localeCompare(buildDiagnosticIdentity(second));
  expect([...incremental].sort(byIdentity)).toEqual([...full].sort(byIdentity));
  expect(incremental.filter((diagnostic) => diagnostic.rule === "hook-use-state")).toHaveLength(
    expectedCount,
  );
};

describe("hook-use-state prop-types sidecar dependency fingerprints", () => {
  it("invalidates unchanged consumers when an alias target appears and disappears", async () => {
    const directory = createFixture("alias-membership");
    const workerObserver = observeFixtureWorker(directory);
    const providerPath = path.join(directory, "provider.ts");
    writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "prop-types": ["./provider"] } } }),
    );
    await expectCurrentVerdict(directory, 0, workerObserver);
    await expectCurrentVerdict(directory, 0, workerObserver);
    writeFile(providerPath, "export default {};\n");
    await expectCurrentVerdict(directory, 1, workerObserver);
    await expectCurrentVerdict(directory, 1, workerObserver);
    fs.rmSync(providerPath);
    await expectCurrentVerdict(directory, 0, workerObserver);
  });

  it("invalidates same-size config edits with restored modification time in one worker", async () => {
    const directory = createFixture("config-content");
    const workerObserver = observeFixtureWorker(directory);
    const configPath = path.join(directory, "tsconfig.json");
    const absentMapping = JSON.stringify({
      compilerOptions: { paths: { "prop-types": ["./absent"] } },
    });
    const actualMapping = JSON.stringify({
      compilerOptions: { paths: { "prop-types": ["./actual"] } },
    });
    writeFile(path.join(directory, "actual.ts"), "export default {};\n");
    writeFile(configPath, absentMapping);
    fs.utimesSync(configPath, preservedTimestamp, preservedTimestamp);
    await expectCurrentVerdict(directory, 0, workerObserver);
    await expectCurrentVerdict(directory, 0, workerObserver);
    writeFile(configPath, actualMapping);
    fs.utimesSync(configPath, preservedTimestamp, preservedTimestamp);
    expect(fs.statSync(configPath).size).toBe(Buffer.byteLength(absentMapping));
    expect(fs.statSync(configPath).mtimeMs).toBe(preservedTimestamp.getTime());
    await expectCurrentVerdict(directory, 1, workerObserver);
    writeFile(configPath, absentMapping);
    fs.utimesSync(configPath, preservedTimestamp, preservedTimestamp);
    await expectCurrentVerdict(directory, 0, workerObserver);
  });
});
