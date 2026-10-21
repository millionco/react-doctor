import { fileURLToPath } from "node:url";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";
import { createOxlintWorkerPool } from "../src/runners/oxlint/oxlint-worker-pool.js";
import * as workerPrespawn from "../src/runners/oxlint/oxlint-worker-prespawn.js";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  resolveOxlintPackageDirectory,
  resolvePluginPath,
} from "../src/runners/oxlint/resolve-paths.js";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";
import { createOxlintSpawnSlots } from "../src/utils/create-oxlint-spawn-slots.js";
import { hashFileContents } from "../src/utils/hash-file-contents.js";
import type { OxlintWorkerProbeResult } from "../src/start-oxlint-worker.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";
import { OXLINT_OUTPUT_MAX_BYTES, OXLINT_SPAWN_TIMEOUT_MS } from "../src/constants.js";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic } from "../src/types/index.js";
import {
  SIDECAR_LINT_CACHE_FILENAME,
  SIDECAR_LINT_CACHE_SCHEMA_VERSION,
} from "../src/constants.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import type {
  SidecarDependencyProbe,
  SidecarFileEntry,
  SidecarLintCache,
} from "../src/runners/oxlint/sidecar-lint-cache.js";

const tempRoots: string[] = [];
const makeCacheDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sidecar-lint-cache-"));
  tempRoots.push(dir);
  return dir;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "no-barrel-import",
  severity: "warning",
  message: "Import from a barrel file",
  help: "Import directly",
  line: 1,
  column: 1,
  category: "Bundle Size",
  ...overrides,
});

const PROBES: ReadonlyArray<SidecarDependencyProbe> = [
  { kind: "content", path: "src/components/index.ts", answer: "hash-index" },
  { kind: "exists", path: "src/components.tsx", answer: "none" },
];

const internProbes = (
  cache: SidecarLintCache,
  probes: ReadonlyArray<SidecarDependencyProbe> = PROBES,
): number[] => probes.map((probe) => cache.internProbe(probe.kind, probe.path, probe.answer));

const entry = (
  cache: SidecarLintCache,
  overrides: Partial<SidecarFileEntry> = {},
): SidecarFileEntry => ({
  probeIds: internProbes(cache),
  diagnostics: [diagnostic()],
  ...overrides,
});

const probesOf = (cache: SidecarLintCache, cached: SidecarFileEntry | null) =>
  cached?.probeIds.map((probeId) => cache.probeAt(probeId));

const answerFromProbes =
  (probes: ReadonlyArray<SidecarDependencyProbe>) =>
  (kind: SidecarDependencyProbe["kind"], probePath: string): string =>
    probes.find((probe) => probe.kind === kind && probe.path === probePath)?.answer ?? "absent";

describe("createSidecarLintCache", () => {
  it("preserves explicit ownership through disk replay", () => {
    const cacheDirectory = makeCacheDir();
    const expected = diagnostic({ contextRanges: [{ offset: 12, length: 34 }] });
    const writer = createSidecarLintCache(cacheDirectory, "ownership");
    writer.store("app hash", { probeIds: [], diagnostics: [expected] });
    writer.persist();
    expect(
      createSidecarLintCache(cacheDirectory, "ownership").lookup("app hash")?.diagnostics[0],
    ).toMatchObject(expected);
  });
  it("round-trips probes + diagnostics across a persist + reload", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.store("src/clean.tsx hashB", entry(writer, { diagnostics: [] }));
    writer.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const replayed = reader.lookup("src/app.tsx hashA");
    expect(replayed).not.toBeNull();
    expect(probesOf(reader, replayed)).toEqual(PROBES);
    expect(replayed?.diagnostics).toHaveLength(1);
    expect(reader.lookup("src/clean.tsx hashB")?.diagnostics).toEqual([]);
    expect(reader.lookup("src/never-seen.tsx hashZ")).toBeNull();
  });

  it("interns one record per distinct (kind, path, answer) across entries", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.store("src/other.tsx hashB", entry(writer));
    const staleProbes = [{ ...PROBES[0], answer: "hash-index-old" }];
    writer.store("src/stale.tsx hashC", {
      probeIds: internProbes(writer, staleProbes),
      diagnostics: [],
    });
    writer.persist();

    const persisted = JSON.parse(
      fs.readFileSync(path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME), "utf8"),
    );
    const bucket = persisted.rulesets["ruleset-1"];
    expect(bucket.probes).toHaveLength(3);
    expect(bucket.files["src/app.tsx hashA"].probeIds).toEqual(
      bucket.files["src/other.tsx hashB"].probeIds,
    );

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const answerFor = answerFromProbes(PROBES);
    expect(reader.isReplayable(reader.lookup("src/app.tsx hashA")!, answerFor)).toBe(true);
    expect(reader.isReplayable(reader.lookup("src/stale.tsx hashC")!, answerFor)).toBe(false);
  });

  it("answers each distinct probe once per cache instance while verifying", () => {
    const cacheDir = makeCacheDir();
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    const first = entry(cache);
    const second = entry(cache);
    let answerCount = 0;
    const answerFor = (kind: SidecarDependencyProbe["kind"], probePath: string): string => {
      answerCount += 1;
      return answerFromProbes(PROBES)(kind, probePath);
    };
    expect(cache.isReplayable(first, answerFor)).toBe(true);
    expect(cache.isReplayable(second, answerFor)).toBe(true);
    expect(answerCount).toBe(PROBES.length);
  });

  it("keeps sibling entries (re-interned) when persisting over a bucket another run wrote", () => {
    const cacheDir = makeCacheDir();
    const sibling = createSidecarLintCache(cacheDir, "ruleset-1");
    sibling.store("src/sibling.tsx hashS", entry(sibling));
    const ours = createSidecarLintCache(cacheDir, "ruleset-1");
    sibling.persist();
    ours.store("src/app.tsx hashA", entry(ours, { diagnostics: [] }));
    ours.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(probesOf(reader, reader.lookup("src/sibling.tsx hashS"))).toEqual(PROBES);
    expect(reader.lookup("src/app.tsx hashA")?.diagnostics).toEqual([]);
  });

  it("isolates entries by ruleset hash (a toolchain/config change is a clean miss)", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.persist();

    expect(createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("degrades an entry with a malformed probe to a miss (never a partial guard)", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            // A probe record missing its answer — replaying diagnostics
            // guarded by a truncated probe set could serve a stale verdict.
            probes: [["content", "src/components/index.ts"]],
            files: {
              "src/app.tsx hashA": {
                probeIds: [0],
                diagnostics: [diagnostic()],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("degrades an entry referencing a probe id outside the table to a miss", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            probes: [["content", "src/components/index.ts", "hash-index"]],
            files: {
              "src/app.tsx hashA": { probeIds: [0, 1], diagnostics: [diagnostic()] },
              "src/ok.tsx hashB": { probeIds: [0], diagnostics: [] },
            },
          },
        },
      }),
    );
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/app.tsx hashA")).toBeNull();
    expect(cache.lookup("src/ok.tsx hashB")).not.toBeNull();
  });

  it("degrades an entry with a malformed diagnostic to a miss", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            probes: [],
            files: {
              "src/app.tsx hashA": {
                probeIds: [],
                diagnostics: [{ notADiagnostic: true }],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("fails open on a corrupt cache file (no throw, treated as empty)", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME), "{ not json !!");
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/app.tsx hashA")).toBeNull();
    cache.store("src/app.tsx hashA", entry(cache));
    expect(() => cache.persist()).not.toThrow();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
  });

  it("preserves sibling ruleset buckets when a different ruleset persists", () => {
    const cacheDir = makeCacheDir();
    const first = createSidecarLintCache(cacheDir, "ruleset-1");
    first.store("src/app.tsx hashA", entry(first));
    first.persist();

    const second = createSidecarLintCache(cacheDir, "ruleset-2");
    second.store("src/other.tsx hashB", entry(second, { diagnostics: [] }));
    second.persist();

    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/other.tsx hashB"),
    ).not.toBeNull();
  });
});

interface ImportedActionPooledScanResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly replayed: boolean;
  readonly probes: ReadonlyArray<SidecarDependencyProbe>;
}

describe("imported request action in the same real worker pool", () => {
  it.each(["content", "deletion", "appearance", "alias-retarget", "same-size-restored-mtime"])(
    "invalidates an unchanged consumer after %s",
    async (transition) => {
      const rootDirectory = makeCacheDir();
      const primaryRelativePath = "src/Panel.tsx";
      const requestRelativePath = "src/request.ts";
      const primaryPath = path.join(rootDirectory, primaryRelativePath);
      const requestPath = path.join(rootDirectory, requestRelativePath);
      const configPath = path.join(rootDirectory, "oxlintrc.json");
      const aliasPath = path.join(rootDirectory, "tsconfig.json");
      const cacheDirectory = path.join(rootDirectory, "cache");
      const ruleId = "no-async-event-handler-without-reentry-guard";
      const ruleKey = `react-doctor/${ruleId}`;
      const primary = `import {useCallback} from 'react';import {send} from '@request';import {useVisibility,useActions} from './state';
const Panel=({dismiss})=>{const submit=useCallback(async()=>{await send('/tasks.commit',{});dismiss()},[dismiss]);return <button onClick={submit}/>};
export const Screen=()=>{const status=useVisibility();const {close}=useActions();return status.open?<Panel dismiss={close}/>:null};
`;
      const request =
        "import axios from 'axios';export async function send(path,body){const result=await axios.post(path,body);return result.data}\n";
      const readonlyRequest = request.replace(".post(", ".get (");
      const timestamp = new Date("2025-01-01T00:00:00.000Z");
      fs.mkdirSync(path.dirname(primaryPath));
      fs.writeFileSync(primaryPath, primary);
      fs.writeFileSync(
        path.join(rootDirectory, "src/state.ts"),
        `import {useCallback} from 'react';import {atom,useAtomValue,useSetAtom} from 'jotai';const visible=atom({open:false});export const useVisibility=()=>useAtomValue(visible);export const useActions=()=>{const write=useSetAtom(visible);const close=useCallback(()=>{write({open:false})},[write]);return {close}};`,
      );
      const aliasConfig = (target: string): string =>
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@request": [target] } } });
      fs.writeFileSync(aliasPath, aliasConfig("./src/request.ts"));
      if (transition !== "appearance") fs.writeFileSync(requestPath, request);
      fs.writeFileSync(path.join(rootDirectory, "src/readonly-request.ts"), readonlyRequest);
      if (transition === "same-size-restored-mtime")
        fs.utimesSync(requestPath, timestamp, timestamp);
      expect(Buffer.byteLength(request)).toBe(Buffer.byteLength(readonlyRequest));
      const primaryHash = hashFileContents(primaryPath);
      if (!primaryHash) throw new Error("Primary content hash unavailable");
      const fileKey = `${primaryRelativePath}\0${primaryHash}`;
      const project = buildProject({ rootDirectory, framework: "vite", hasReactCompiler: false });
      const pluginPath = resolvePluginPath();
      const generated = createOxlintConfig({
        pluginPath,
        project,
        customRulesOnly: true,
        disableReactHooksJsPlugin: true,
        ignoredTags: new Set(),
        severityControls: { rules: { [ruleKey]: "warn" } },
      });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          ...generated,
          rules: {
            ...Object.fromEntries(Object.keys(generated.rules).map((key) => [key, "off"])),
            [ruleKey]: "warn",
          },
        }),
      );
      const workerScriptPath = fileURLToPath(new URL("../dist/oxlint-worker.js", import.meta.url));
      expect(fs.existsSync(workerScriptPath)).toBe(true);
      expect(fs.existsSync(pluginPath)).toBe(true);
      const spawnObservation = vi.spyOn(workerPrespawn, "spawnOxlintWorkerProcess");
      const pool = createOxlintWorkerPool({
        nodeBinaryPath: process.execPath,
        workerScriptPath,
        oxlintPackageDirectory: resolveOxlintPackageDirectory(),
        pluginPath,
        maxWorkers: 1,
        environment: { ...process.env, REACT_DOCTOR_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" },
      });
      const scan = async (useCache: boolean): Promise<ImportedActionPooledScanResult> => {
        const epoch = createOxlintSpawnSlots(1).filesystemCacheEpoch;
        const cache = createSidecarLintCache(cacheDirectory, "real-imported-action-pooled-epoch");
        const answers = createSidecarProbeAnswerResolver({
          rootDirectory,
          contentHashByRelativePath: new Map([[primaryRelativePath, primaryHash]]),
        });
        const previous = useCache ? cache.lookup(fileKey) : null;
        if (previous && cache.isReplayable(previous, answers.answerFor))
          return {
            diagnostics: previous.diagnostics,
            replayed: true,
            probes: previous.probeIds.map(cache.probeAt),
          };
        const job = {
          cwd: rootDirectory,
          timeoutMs: OXLINT_SPAWN_TIMEOUT_MS,
          outputMaxBytes: OXLINT_OUTPUT_MAX_BYTES,
          filesystemCacheEpoch: epoch,
        };
        const stdout = await pool.run({
          ...job,
          argumentsList: [
            "-c",
            configPath,
            "--format",
            "json",
            "--threads",
            "1",
            primaryRelativePath,
          ],
        });
        const diagnostics = parseOxlintOutput(stdout, project, rootDirectory);
        const recorded: OxlintWorkerProbeResult = JSON.parse(
          await pool.run({
            ...job,
            argumentsList: [],
            probeRequest: { files: [primaryRelativePath], ruleIds: [ruleId] },
          }),
        );
        const trace = recorded.traces.find((candidate) => candidate?.file === primaryRelativePath);
        if (!trace) throw new Error("Real worker omitted dependency trace");
        const fresh: SidecarFileEntry = {
          diagnostics,
          probeIds: [
            ...trace.content.map((index) =>
              cache.internProbe(
                "content",
                recorded.paths[index],
                answers.answerFor("content", recorded.paths[index]),
              ),
            ),
            ...trace.existence.map((index) =>
              cache.internProbe(
                "exists",
                recorded.paths[index],
                recorded.existenceAnswers[index] ??
                  answers.answerFor("exists", recorded.paths[index]),
              ),
            ),
          ],
        };
        if (useCache) {
          cache.store(fileKey, fresh);
          cache.persist();
        }
        return { diagnostics, replayed: false, probes: fresh.probeIds.map(cache.probeAt) };
      };
      try {
        const cold = await scan(true);
        expect(cold.replayed).toBe(false);
        expect(cold.diagnostics).toHaveLength(transition === "appearance" ? 0 : 1);
        const warm = await scan(true);
        expect(warm.replayed).toBe(true);
        expect(warm.diagnostics).toEqual(cold.diagnostics);
        const beforeMetadata = fs.readFileSync(
          path.join(cacheDirectory, SIDECAR_LINT_CACHE_FILENAME),
          "utf8",
        );
        if (transition === "deletion") fs.unlinkSync(requestPath);
        else if (transition === "appearance") fs.writeFileSync(requestPath, request);
        else if (transition === "alias-retarget")
          fs.writeFileSync(aliasPath, aliasConfig("./src/readonly-request.ts"));
        else {
          fs.writeFileSync(requestPath, readonlyRequest);
          if (transition === "same-size-restored-mtime")
            fs.utimesSync(requestPath, timestamp, timestamp);
        }
        if (transition === "same-size-restored-mtime") {
          expect(fs.statSync(requestPath).mtimeMs).toBe(timestamp.getTime());
          expect(fs.statSync(requestPath).size).toBe(Buffer.byteLength(request));
        }
        expect(fs.readFileSync(primaryPath, "utf8")).toBe(primary);
        expect(hashFileContents(primaryPath)).toBe(primaryHash);
        const incremental = await scan(true);
        expect(incremental.replayed).toBe(false);
        expect(incremental.diagnostics).toHaveLength(transition === "appearance" ? 1 : 0);
        expect(incremental.probes).not.toEqual(cold.probes);
        expect(
          fs.readFileSync(path.join(cacheDirectory, SIDECAR_LINT_CACHE_FILENAME), "utf8"),
        ).not.toBe(beforeMetadata);
        const full = await scan(false);
        expect(full.diagnostics).toEqual(incremental.diagnostics);
        const warmAfter = await scan(true);
        expect(warmAfter.replayed).toBe(true);
        expect(warmAfter.diagnostics).toEqual(incremental.diagnostics);
        expect(pool.workerCount()).toBe(1);
        expect(spawnObservation).toHaveBeenCalledTimes(1);
        const spawned = spawnObservation.mock.results[0];
        if (spawned?.type !== "return") throw new Error("Worker spawn was not observed");
        expect(spawned.value.pid).toBeGreaterThan(0);
      } finally {
        await pool.close();
        spawnObservation.mockRestore();
      }
    },
    OXLINT_SPAWN_TIMEOUT_MS,
  );
});
