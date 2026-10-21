import { execFileSync } from "node:child_process";
import fixtures from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-direct-state-mutation.workspace-fixtures.json";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { OXLINT_OUTPUT_MAX_BYTES, OXLINT_SPAWN_TIMEOUT_MS } from "../src/constants.js";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";
import { createOxlintWorkerPool } from "../src/runners/oxlint/oxlint-worker-pool.js";
import * as workerPrespawn from "../src/runners/oxlint/oxlint-worker-prespawn.js";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  resolveOxlintPackageDirectory,
  resolvePluginPath,
} from "../src/runners/oxlint/resolve-paths.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import type { OxlintWorkerProbeResult } from "../src/start-oxlint-worker.js";
import type { Diagnostic } from "../src/types/index.js";
import { createOxlintSpawnSlots } from "../src/utils/create-oxlint-spawn-slots.js";
import { hashFileContents } from "../src/utils/hash-file-contents.js";
import { sortDiagnosticsStable } from "../src/utils/sort-diagnostics-stable.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

const workspaceRoots: string[] = [];

afterEach(() => {
  for (const workspaceRoot of workspaceRoots.splice(0))
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("workspace ref relay in a persistent worker", () => {
  it(
    "updates unchanged consumers across provider and ignored workspace membership changes",
    async () => {
      const workspaceRoot = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "rd-workspace-relay-")),
      );
      workspaceRoots.push(workspaceRoot);
      for (const [relativePath, contents] of Object.entries(fixtures.baseFiles)) {
        const filename = path.join(workspaceRoot, relativePath);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, contents);
      }
      fs.writeFileSync(path.join(workspaceRoot, ".gitignore"), "packages/ref-kit/.template/\n");
      execFileSync("git", ["init", "--quiet", workspaceRoot]);
      const consumerRoot = path.join(workspaceRoot, "packages/ui");
      const primaryRelativePath = "src/panel.tsx";
      const primaryPath = path.join(consumerRoot, primaryRelativePath);
      const providerPath = path.join(workspaceRoot, "packages/ref-kit/src/relay.ts");
      const duplicateRoot = path.join(workspaceRoot, "packages/ref-kit/.template/duplicate");
      const configPath = path.join(consumerRoot, "oxlintrc.json");
      const cacheDirectory = path.join(consumerRoot, "cache");
      const ruleId = "no-direct-state-mutation";
      const ruleKey = `react-doctor/${ruleId}`;
      const provider = fs.readFileSync(providerPath, "utf8");
      const unsafeProvider = provider.replace("ref(element)", "ref({x:  1})");
      expect(unsafeProvider).not.toBe(provider);
      expect(Buffer.byteLength(unsafeProvider)).toBe(Buffer.byteLength(provider));
      const timestamp = new Date("2025-01-01T00:00:00.000Z");
      const primary = fs.readFileSync(primaryPath, "utf8");
      const primaryHash = hashFileContents(primaryPath);
      if (!primaryHash) throw new Error("Primary content hash unavailable");
      const fileKey = `${primaryRelativePath}\0${primaryHash}`;
      const project = buildProject({
        rootDirectory: consumerRoot,
        framework: "vite",
        hasReactCompiler: false,
      });
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
      const scan = async (useCache: boolean) => {
        const epoch = createOxlintSpawnSlots(1).filesystemCacheEpoch;
        const cache = useCache
          ? createSidecarLintCache(cacheDirectory, "workspace-relay-unbounded")
          : null;
        if (cache) expect(cache.lookup(fileKey)).toBeNull();
        const job = {
          cwd: consumerRoot,
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
        const diagnostics = sortDiagnosticsStable(parseOxlintOutput(stdout, project, consumerRoot));
        if (cache) {
          const probes: OxlintWorkerProbeResult = JSON.parse(
            await pool.run({
              ...job,
              argumentsList: [],
              probeRequest: { files: [primaryRelativePath], ruleIds: [ruleId] },
            }),
          );
          expect(probes.traces).toEqual([null]);
          cache.persist();
          expect(
            createSidecarLintCache(cacheDirectory, "workspace-relay-unbounded").lookup(fileKey),
          ).toBeNull();
        }
        return diagnostics;
      };
      let unsafeDiagnostics: Diagnostic[] | undefined;
      const assertPhase = async (warningCount: number) => {
        expect(fs.readFileSync(primaryPath, "utf8")).toBe(primary);
        expect(hashFileContents(primaryPath)).toBe(primaryHash);
        const withCache = await scan(true);
        expect(withCache).toHaveLength(warningCount);
        if (warningCount) {
          expect(withCache[0]).toMatchObject({
            filePath: primaryRelativePath,
            plugin: "react-doctor",
            rule: ruleId,
            severity: "warning",
          });
          if (unsafeDiagnostics) expect(withCache).toEqual(unsafeDiagnostics);
          else unsafeDiagnostics = withCache;
        }
        const cacheOff = await scan(false);
        expect(cacheOff).toEqual(withCache);
        expect(pool.workerCount()).toBe(1);
        expect(spawnObservation).toHaveBeenCalledTimes(1);
      };
      try {
        await assertPhase(0);
        fs.writeFileSync(providerPath, unsafeProvider);
        await assertPhase(1);
        fs.writeFileSync(providerPath, provider);
        await assertPhase(0);
        fs.unlinkSync(providerPath);
        await assertPhase(1);
        fs.writeFileSync(providerPath, provider);
        fs.utimesSync(providerPath, timestamp, timestamp);
        await assertPhase(0);
        fs.writeFileSync(providerPath, unsafeProvider);
        fs.utimesSync(providerPath, timestamp, timestamp);
        expect(fs.statSync(providerPath).mtimeMs).toBe(timestamp.getTime());
        expect(fs.statSync(providerPath).size).toBe(Buffer.byteLength(provider));
        await assertPhase(1);
        fs.writeFileSync(providerPath, provider);
        await assertPhase(0);
        fs.mkdirSync(duplicateRoot, { recursive: true });
        fs.writeFileSync(
          path.join(duplicateRoot, "package.json"),
          JSON.stringify({ name: "@sample/ref-kit" }),
        );
        expect(
          execFileSync(
            "git",
            [
              "-C",
              workspaceRoot,
              "check-ignore",
              "packages/ref-kit/.template/duplicate/package.json",
            ],
            { encoding: "utf8" },
          ).trim(),
        ).toBe("packages/ref-kit/.template/duplicate/package.json");
        await assertPhase(1);
        fs.rmSync(duplicateRoot, { recursive: true });
        await assertPhase(0);
        const spawned = spawnObservation.mock.results[0];
        if (spawned?.type !== "return") throw new Error("Worker spawn was not observed");
        expect(spawned.value.pid).toBeGreaterThan(0);
      } finally {
        try {
          await pool.close();
        } finally {
          spawnObservation.mockRestore();
        }
      }
    },
    OXLINT_SPAWN_TIMEOUT_MS,
  );
});
