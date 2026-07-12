import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import {
  CROSS_FILE_DEPENDENCY_COLLECTORS,
  CROSS_FILE_RULE_IDS,
  collectCrossFileDependencyProbes,
  resetManifestCaches,
} from "oxlint-plugin-react-doctor";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "./types/index.js";
import { batchIncludePaths } from "./batch-include-paths.js";
import { COOPERATIVE_YIELD_BUDGET_MS } from "./constants.js";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import { canOxlintExtendConfig } from "./can-oxlint-extend-config.js";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { detectUserLintConfigPaths } from "./detect-user-lint-config.js";
import { ReactDoctorError } from "./errors.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";
import { computeRulesetHash } from "./runners/oxlint/compute-ruleset-hash.js";
import { createOxlintConfig } from "./runners/oxlint/config.js";
import { createFileLintCache } from "./runners/oxlint/file-lint-cache.js";
import { createSidecarProbeAnswerResolver } from "./runners/oxlint/resolve-sidecar-probe-answer.js";
import type { SidecarProbeAnswerResolver } from "./runners/oxlint/resolve-sidecar-probe-answer.js";
import { createSidecarLintCache } from "./runners/oxlint/sidecar-lint-cache.js";
import type {
  SidecarDependencyProbe,
  SidecarLintCache,
} from "./runners/oxlint/sidecar-lint-cache.js";
import { resolveUserPlugins } from "./runners/oxlint/plugin-resolution.js";
import { resolveOxlintToolchainVersions } from "./runners/oxlint/resolve-toolchain-versions.js";
import {
  resolveOxlintBinary,
  resolvePluginPath,
  resolveTsConfigRelativePath,
} from "./runners/oxlint/resolve-paths.js";
import { spawnLintBatches } from "./runners/oxlint/spawn-batches.js";
import { validateRuleRegistration } from "./runners/oxlint/validate-rule-registration.js";
import { dedupeDiagnostics } from "./utils/dedupe-diagnostics.js";
import { hashFileContents } from "./utils/hash-file-contents.js";
import { listSourceFilesWithSize } from "./utils/list-source-files.js";
import { planLintBatches } from "./utils/plan-lint-batches.js";
import { resolveReactDoctorCacheDir } from "./utils/resolve-react-doctor-cache-dir.js";
import { yieldToEventLoop } from "./utils/yield-to-event-loop.js";

interface RunOxlintOptions {
  rootDirectory: string;
  project: ProjectInfo;
  includePaths?: string[];
  nodeBinaryPath?: string;
  customRulesOnly?: boolean;
  respectInlineDisables?: boolean;
  adoptExistingLintConfig?: boolean;
  ignoredTags?: ReadonlySet<string>;
  /**
   * Optional react-doctor user config (already-loaded
   * `react-doctor.config.json` or `package.json#reactDoctor`). When
   * provided, project-level knobs the rule surface honors —
   * currently `serverAuthFunctionNames` — are forwarded to the
   * generated oxlint settings so plugin rules can read them via
   * `context.settings`. `userConfig.plugins` resolves through
   * `configSourceDirectory` (or `rootDirectory` as the fallback).
   */
  userConfig?: ReactDoctorConfig | null;
  /**
   * Directory of the `react-doctor.config.json` (or `package.json`)
   * that supplied `userConfig`. Used as the resolution base for
   * `userConfig.plugins` entries — relative paths resolve against
   * this directory and npm package names resolve through its
   * `node_modules`, matching how `rootDir` resolves. Diverges from
   * `rootDirectory` whenever `userConfig.rootDir` redirects the scan.
   *
   * Defaults to `rootDirectory` for direct callers that don't load
   * a config file.
   */
  configSourceDirectory?: string;
  /**
   * Called once per soft-fail event (e.g. a batch hit
   * `OXLINT_SPAWN_TIMEOUT_MS` and was skipped). The lint scan keeps
   * going on remaining batches; the caller is expected to surface
   * the warning to the user (via `skippedCheckReasons` in JSON
   * mode, or a logger message in human mode).
   */
  onPartialFailure?: (reason: string) => void;
  onFileCoverage?: (coverage: RunOxlintFileCoverage) => void;
  onFileProgress?: (scannedFileCount: number, totalFileCount: number) => void;
  /**
   * Enables the per-file lint cache, resolved from the
   * `PerFileLintCacheEnabled` Reference. When on (and the scan is eligible —
   * no audit mode, no adopted `extends`, no user plugins), unchanged files
   * replay their cached cacheable-rule diagnostics and only changed files are
   * re-linted; the cross-file rules always run fresh on every file (in the
   * misses' full pass, and in a sidecar pass over the cache hits).
   */
  perFileLintCacheEnabled?: boolean;
  /**
   * Enables the sidecar lint cache, resolved from the
   * `SidecarLintCacheEnabled` Reference. When on (and the per-file cache is
   * active), each cache-hit file's cross-file diagnostics replay from the
   * sidecar store as long as the file's recorded dependency probes still
   * match the tree; only mismatching files re-lint. Off → every cache hit
   * runs the always-fresh sidecar pass (the pre-cache behavior).
   */
  sidecarLintCacheEnabled?: boolean;
  /**
   * Called once after the cache split with `(cacheHitFileCount,
   * totalConsideredFileCount)`. Surfaced to the Sentry wide event as
   * `lintCacheHitRatio`. Not invoked when the cache is disabled or bypassed.
   */
  onCacheStats?: (cacheHitFileCount: number, totalConsideredFileCount: number) => void;
  /**
   * Called once with `(sidecarReplayedFileCount, sidecarConsideredFileCount)`
   * — how many cache-hit files replayed their cross-file diagnostics from
   * the sidecar store vs. the hits considered. Surfaced to the Sentry wide
   * event as `lint.sidecarReplayRatio`. Not invoked when the sidecar cache
   * is disabled or bypassed.
   */
  onSidecarStats?: (sidecarReplayedFileCount: number, sidecarConsideredFileCount: number) => void;
  /** Per-batch wall-clock budget, resolved from the `OxlintSpawnTimeoutMs` Reference. */
  spawnTimeoutMs?: number;
  /** Per-batch stdout+stderr byte cap, resolved from the `OxlintOutputMaxBytes` Reference. */
  outputMaxBytes?: number;
  /**
   * Number of oxlint subprocesses to run in parallel, resolved from the
   * `OxlintConcurrency` Reference (which itself defaults to parallel —
   * auto-detected cores). Omitting it here uses the low-level serial
   * default; the orchestrated path always threads the Reference value
   * through. A parallel pass auto-falls-back to serial on resource
   * exhaustion (see `spawnLintBatches`).
   */
  concurrency?: number;
  /**
   * Aborted when the orchestrator's lint-phase timeout fires; forwarded to
   * `spawnLintBatches` so in-flight oxlint subprocesses are torn down instead
   * of running on after the phase is abandoned.
   */
  signal?: AbortSignal;
  /** See `SpawnLintBatchesInput.deadlineEpochMs`. */
  deadlineEpochMs?: number;
  /**
   * Full-scan batch planning, resolved from the `LintBatchOrdering`
   * Reference. `"cost"` (the default) plans size-balanced LPT batches via
   * `planLintBatches`; `"arrival"` is the rollback hatch to the plain greedy
   * 100-file chunking in discovery order. Only affects the full-scan branch
   * (`includePaths` undefined) — diff / staged scans pass explicit paths and
   * are untouched.
   */
  lintBatchOrdering?: "cost" | "arrival";
}

export interface RunOxlintFileCoverage {
  readonly candidateFiles: ReadonlyArray<string>;
  readonly analyzedFiles: ReadonlyArray<string>;
}

/**
 * Atomically (re)writes the generated oxlintrc.json. Used twice in
 * the runner: once for the primary scan, once for the
 * extends-stripped retry fallback. Re-creates the file via
 * `open(wx)` after `fs.rm` so a stale config at the path is treated
 * as a failure rather than silently overwritten — the only
 * legitimate overwriter is `this` runner inside the same temp dir.
 */
const writeOxlintConfig = (
  configPath: string,
  configToWrite: ReturnType<typeof createOxlintConfig>,
): void => {
  fs.rmSync(configPath, { force: true });
  const fileHandle = fs.openSync(configPath, "wx", 0o600);
  try {
    fs.writeFileSync(fileHandle, JSON.stringify(configToWrite));
  } finally {
    fs.closeSync(fileHandle);
  }
};

/**
 * Attributes diagnostics back to the file that produced them by the
 * normalized path oxlint echoes. Returns `null` when ANY diagnostic can't be
 * attributed — the path forms don't align, so the caller must skip its cache
 * store rather than risk caching a wrong empty result for a file that
 * actually had diagnostics.
 */
const attributeDiagnosticsToFiles = (
  diagnostics: ReadonlyArray<Diagnostic>,
  files: ReadonlyArray<string>,
): Map<string, Diagnostic[]> | null => {
  const fileByNormalizedPath = new Map<string, string>();
  for (const file of files) {
    fileByNormalizedPath.set(file.replaceAll("\\", "/"), file);
  }
  const diagnosticsByFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const file = fileByNormalizedPath.get(diagnostic.filePath);
    if (file === undefined) return null;
    const fileDiagnostics = diagnosticsByFile.get(file) ?? [];
    fileDiagnostics.push(diagnostic);
    diagnosticsByFile.set(file, fileDiagnostics);
  }
  return diagnosticsByFile;
};

interface SidecarStorablePass {
  readonly files: ReadonlyArray<string>;
  /** Cross-file BOUNDED-rule diagnostics this pass produced for `files`. */
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  /** False when the pass had a partial failure or a config fallback — its
   * output may be incomplete, so nothing from it is stored. */
  readonly isTrusted: boolean;
  /** Each file's answered probe set (from `collectSidecarProbesForFiles`). */
  readonly probesByFile: ReadonlyMap<string, ReadonlyArray<SidecarDependencyProbe> | null>;
}

/**
 * Collects each file's cross-file dependency probes (via the plugin's
 * collectors) with their current answers. Fail-open per file: an unreadable /
 * unparseable / collector-failing file maps to `null` (no entry stored — it
 * re-lints next scan). The filesystem is frozen for the scan, so this can run
 * CONCURRENTLY with an oxlint child-process await — the caller starts it
 * unawaited before a lint pass and awaits it at store time, hiding the
 * in-process parse + resolution cost under the subprocess wait. The loop
 * yields on the cooperative time budget so the child's stdout handling (and
 * sibling fibers) keep flowing; each per-file collection is synchronous, so
 * the module-level probe recorder never sees interleaved use. Never rejects.
 */
const collectSidecarProbesForFiles = async (input: {
  files: ReadonlyArray<string>;
  rootDirectory: string;
  boundedSidecarRuleIds: ReadonlyArray<string>;
  probeAnswers: SidecarProbeAnswerResolver;
}): Promise<Map<string, ReadonlyArray<SidecarDependencyProbe> | null>> => {
  const buildProbes = (file: string): SidecarDependencyProbe[] | null => {
    const absoluteFilePath = path.resolve(input.rootDirectory, file);
    let trace: ReturnType<typeof collectCrossFileDependencyProbes>;
    try {
      trace = collectCrossFileDependencyProbes({
        absoluteFilePath,
        sourceText: fs.readFileSync(absoluteFilePath, "utf8"),
        ruleIds: input.boundedSidecarRuleIds,
      });
    } catch {
      return null;
    }
    if (trace === null) return null;
    const probes: SidecarDependencyProbe[] = [];
    for (const contentPath of trace.contentPaths) {
      const relativePath = input.probeAnswers.toRelativePath(contentPath);
      probes.push({
        kind: "content",
        path: relativePath,
        answer: input.probeAnswers.answerFor("content", relativePath),
      });
    }
    // A path can carry BOTH probe kinds (e.g. a package.json probed for
    // existence during the ancestor walk and then read): keep both — the
    // content answer can't distinguish a directory from a missing file, but
    // the resolvers can (`"dir"` vs `"none"`).
    for (const existencePath of trace.existencePaths) {
      const relativePath = input.probeAnswers.toRelativePath(existencePath);
      probes.push({
        kind: "exists",
        path: relativePath,
        answer: input.probeAnswers.answerFor("exists", relativePath),
      });
    }
    return probes;
  };

  const probesByFile = new Map<string, ReadonlyArray<SidecarDependencyProbe> | null>();
  let collectSliceStartedAt = performance.now();
  for (const file of input.files) {
    probesByFile.set(file, buildProbes(file));
    if (performance.now() - collectSliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      collectSliceStartedAt = performance.now();
    }
  }
  return probesByFile;
};

/**
 * Stores each freshly-linted file's probe set + cross-file diagnostics so
 * the next scan can replay instead of re-linting.
 */
const storeSidecarEntries = (input: {
  sidecarCache: SidecarLintCache;
  cacheKeyByFile: ReadonlyMap<string, string>;
  storablePasses: ReadonlyArray<SidecarStorablePass>;
}): void => {
  let didStoreAnyEntry = false;
  for (const pass of input.storablePasses) {
    if (!pass.isTrusted) continue;
    const diagnosticsByFile = attributeDiagnosticsToFiles(pass.diagnostics, pass.files);
    if (diagnosticsByFile === null) continue;
    for (const file of pass.files) {
      const cacheKey = input.cacheKeyByFile.get(file);
      if (cacheKey === undefined) continue;
      const probes = pass.probesByFile.get(file);
      if (probes === undefined || probes === null) continue;
      input.sidecarCache.store(cacheKey, {
        probes,
        diagnostics: diagnosticsByFile.get(file) ?? [],
      });
      didStoreAnyEntry = true;
    }
  }
  if (didStoreAnyEntry) input.sidecarCache.persist();
};

const REACT_HOOKS_JS_DROP_PREFIX =
  "React Compiler rules (react-hooks-js/*) skipped — eslint-plugin-react-hooks failed to load in this environment";

/**
 * Detects an oxlint config-load crash caused by the optional
 * `react-hooks-js` (eslint-plugin-react-hooks) React Compiler plugin and
 * builds the partial-failure note for it; returns `null` when the failure
 * was anything else.
 *
 * oxlint prints a framed error to stdout (not stderr) and exits non-zero
 * when a `jsPlugins` entry can't be imported; that non-JSON stdout
 * surfaces as `OxlintOutputUnparseable`. Because oxlint fails the WHOLE
 * config load on it, leaving the plugin in would drop every curated
 * react-doctor diagnostic too — so the caller retries with the plugin
 * stripped (issue #833). Both markers sit at the start of oxlint's
 * message, so they survive the `preview` slice even for deep pnpm paths.
 */
export const reactHooksJsPluginDropNote = (error: unknown): string | null => {
  if (!(error instanceof ReactDoctorError) || error.reason._tag !== "OxlintOutputUnparseable") {
    return null;
  }
  const { preview } = error.reason;
  if (
    !preview.includes("Failed to load JS plugin") ||
    !preview.includes("eslint-plugin-react-hooks")
  ) {
    return null;
  }
  // Surface oxlint's underlying reason ("Error: Cannot find module …")
  // instead of echoing its whole framed dump; omit it if the line didn't
  // survive the preview slice.
  const underlyingReason = preview.match(/Error:[^\n]*/)?.[0]?.trim();
  const reasonSuffix = underlyingReason ? `: ${underlyingReason}` : "";
  return `${REACT_HOOKS_JS_DROP_PREFIX}${reasonSuffix}. Other rules ran normally.`;
};

/**
 * The oxlint runner. Composed of three pieces in `runners/oxlint/`:
 *
 *   - `resolve-paths.ts`    — oxlint binary + plugin + tsconfig resolution
 *   - `spawn-oxlint.ts`     — one subprocess invocation with hard ceilings
 *   - `spawn-batches.ts`    — the batching loop with binary-split retry
 *   - `parse-output.ts`     — oxlint stdout → `Diagnostic[]`
 *   - `validate-rule-registration.ts` — one-time metadata-drift check
 *
 * This file owns the orchestration:
 *
 *   1. resolve plugins / extends / ignore patterns / tsconfig path
 *   2. build the oxlintrc.json via `createOxlintConfig`
 *   3. neutralize inline disable directives in audit mode
 *   4. spawn `spawnLintBatches` against the file batches
 *   5. on extends-related crashes, retry once with extends stripped
 *   6. always restore disable directives + clean up the temp dir
 */
export const runOxlint = async (options: RunOxlintOptions): Promise<Diagnostic[]> => {
  const {
    rootDirectory,
    project,
    includePaths,
    nodeBinaryPath = process.execPath,
    customRulesOnly = false,
    respectInlineDisables = true,
    adoptExistingLintConfig = true,
    ignoredTags = new Set<string>(),
    userConfig,
    configSourceDirectory = rootDirectory,
    onPartialFailure,
    onFileCoverage,
    perFileLintCacheEnabled = false,
    sidecarLintCacheEnabled = false,
    onCacheStats,
    onSidecarStats,
    spawnTimeoutMs,
    outputMaxBytes,
    lintBatchOrdering = "cost",
  } = options;

  const serverAuthFunctionNames = Array.isArray(userConfig?.serverAuthFunctionNames)
    ? userConfig.serverAuthFunctionNames.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      )
    : undefined;
  const severityControls = buildRuleSeverityControls(userConfig);

  validateRuleRegistration();

  // A new scan starts here: drop the plugin's nearest-package.json memos so
  // the in-process sidecar probe collection (`collectSidecarProbesForFiles`)
  // never replays a previous scan's package-directory walk or manifest
  // verdict in a long-lived host (LSP server). Within this scan the memos
  // are sound — the filesystem is treated as frozen while the scan runs.
  resetManifestCaches();

  if (includePaths !== undefined && includePaths.length === 0) {
    onFileCoverage?.({ candidateFiles: [], analyzedFiles: [] });
    return [];
  }

  const pluginPath = resolvePluginPath();
  // HACK: pass user lint configs to oxlint as absolute paths. oxlint's
  // docs say `extends` is "resolved relative to the configuration
  // file that declares extends," but a literal `path.relative(configDir, ...)`
  // breaks when the OS resolves symlinked tmp dirs (e.g. macOS's
  // `/var/folders/.../T/...` actually lives under `/private/var/...`,
  // so a `../../../...` walk from the symlink view doesn't equal the
  // same walk from the canonical view and oxlint's NotFound errors
  // out). Absolute paths sidestep the whole symlink dance. We skip
  // extends entirely under `customRulesOnly` because that mode opts
  // out of every rule outside the react-doctor plugin.
  const detectedConfigPaths =
    adoptExistingLintConfig && !customRulesOnly ? detectUserLintConfigPaths(rootDirectory) : [];
  // HACK: filter out `.eslintrc.json` files whose `extends` lists only
  // bare-package refs (`"next"`, `"airbnb"`, `"plugin:foo/bar"`).
  // oxlint's resolver can't follow those — adopting them guarantees
  // the parser crash + misleading warning. Drop them up front so the
  // scan starts in the same state the fallback would land in.
  const extendsPaths = detectedConfigPaths.filter(canOxlintExtendConfig);
  const userPlugins = resolveUserPlugins(userConfig?.plugins, configSourceDirectory);

  const buildConfig = (overrides: {
    extendsPaths: string[];
    disableReactHooksJsPlugin?: boolean;
    ruleSelection?: "cacheable" | "sidecar";
    sidecarRuleIdFilter?: ReadonlySet<string>;
  }) =>
    createOxlintConfig({
      pluginPath,
      project,
      customRulesOnly,
      extendsPaths: overrides.extendsPaths,
      ignoredTags,
      serverAuthFunctionNames,
      severityControls,
      userPlugins,
      disableReactHooksJsPlugin: overrides.disableReactHooksJsPlugin,
      ruleSelection: overrides.ruleSelection,
      sidecarRuleIdFilter: overrides.sidecarRuleIdFilter,
    });

  // HACK: only neutralize disable comments in audit mode. Default
  // behavior respects the user's existing `// eslint-disable*` /
  // `// oxlint-disable*` directives — we let oxlint apply them.
  const restoreDisableDirectives = respectInlineDisables
    ? () => {}
    : await neutralizeDisableDirectives(rootDirectory, includePaths);

  // Created last so any throw in the setup above (plugin resolution,
  // user-plugin loading) happens before the temp dir exists — nothing
  // between here and the try can throw, so the finally always owns
  // cleanup.
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxlintrc-"));
  const configPath = path.join(configDirectory, "oxlintrc.json");

  try {
    const oxlintBinary = resolveOxlintBinary();
    // Args shared by every batch regardless of which oxlintrc is active, so
    // the cache path can point separate `-c` configs at the same tsconfig +
    // ignore inputs.
    const sharedArgs: string[] = [];

    // Captured for the ruleset hash: oxlint parses with this tsconfig, so a
    // tsconfig edit must bust the per-file cache even when source content is
    // unchanged.
    let tsconfigContent: string | null = null;
    if (project.hasTypeScript) {
      const tsconfigRelativePath = resolveTsConfigRelativePath(rootDirectory);
      if (tsconfigRelativePath) {
        sharedArgs.push("--tsconfig", tsconfigRelativePath);
        try {
          tsconfigContent = fs.readFileSync(
            path.resolve(rootDirectory, tsconfigRelativePath),
            "utf8",
          );
        } catch {
          tsconfigContent = null;
        }
      }
    }

    // HACK: pass every ignore source via a single combined
    // `--ignore-path` file (cheap on `baseArgs` length) rather than
    // N `--ignore-pattern` entries (which would inflate per-batch
    // arg length and shrink the file-count budget on large diffs).
    // The combined file MUST include `.eslintignore` patterns
    // because `--ignore-path` overrides oxlint's automatic
    // `.eslintignore` lookup.
    const combinedPatterns = collectIgnorePatterns(rootDirectory);
    if (combinedPatterns.length > 0) {
      const combinedIgnorePath = path.join(configDirectory, "combined.ignore");
      fs.writeFileSync(combinedIgnorePath, `${combinedPatterns.join("\n")}\n`);
      sharedArgs.push("--ignore-path", combinedIgnorePath);
    }

    const makeBaseArgs = (oxlintConfigPath: string): string[] => [
      oxlintBinary,
      "-c",
      oxlintConfigPath,
      "--format",
      "json",
      ...sharedArgs,
    ];

    // HACK: when `includePaths` is undefined we used to pass `["."]`
    // and let oxlint walk the tree itself. That defeated batching
    // entirely — verified on supabase/studio (3567 source files)
    // that JS-plugin rules hit the 5-min `OXLINT_SPAWN_TIMEOUT_MS`
    // in a single batch, leaving `skippedChecks: ["lint"]` and zero
    // diagnostics. Materializing the file list ahead of time and
    // feeding it through the batch planner keeps each spawn under
    // the timeout and recovers the diagnostics we were dropping.
    // Hand the event loop back once before the synchronous discovery walk +
    // cache-hash burst below. The orchestrator forked the security-scan and
    // supply-chain fibers just before lint, but a forked fiber only runs when
    // the current one suspends — this is their first chance to start (fire the
    // Socket.dev requests, begin the scan walk) instead of stalling until the
    // first oxlint spawn.
    await yieldToEventLoop();
    // Only a full scan pays the walk — diff / staged scans pass
    // explicit paths.
    const sizedScanFiles =
      includePaths === undefined ? listSourceFilesWithSize(rootDirectory) : null;
    const candidateFiles =
      includePaths !== undefined ? includePaths : (sizedScanFiles ?? []).map((entry) => entry.path);

    // `"cost"` (the default) plans size-balanced LPT batches — the size is
    // the discovery walk's existing stat, captured rather than re-paid.
    // `"arrival"` (the `REACT_DOCTOR_LINT_BATCH_ORDERING` rollback hatch) and
    // every explicit-`includePaths` scan keep the plain greedy chunking.
    const sizeByFile =
      sizedScanFiles !== null && lintBatchOrdering === "cost"
        ? new Map(sizedScanFiles.map((entry) => [entry.path, entry.sizeBytes]))
        : null;
    const buildFileBatches = (passBaseArgs: string[], passFiles: string[]): string[][] =>
      sizeByFile !== null
        ? planLintBatches({ baseArgs: passBaseArgs, files: passFiles, sizeByFile })
        : batchIncludePaths(passBaseArgs, passFiles);

    // Runs one oxlintrc over a file list, retrying once with the optional
    // react-hooks-js plugin stripped if it fails to import (issue #833).
    // Shared by the cacheable + sidecar passes; the sidecar carries no
    // react-hooks-js plugin, so its fallback never fires.
    const runConfigOverFiles = async (
      buildConfigForPass: (overrides: {
        disableReactHooksJsPlugin?: boolean;
      }) => ReturnType<typeof createOxlintConfig>,
      configFileName: string,
      files: string[],
      fileProgress: ((scannedFileCount: number, totalFileCount: number) => void) | undefined,
    ): Promise<{
      diagnostics: Diagnostic[];
      analyzedFiles: ReadonlyArray<string>;
      didDropReactHooksJsPlugin: boolean;
      hadPartialFailure: boolean;
    }> => {
      if (files.length === 0) {
        return {
          diagnostics: [],
          analyzedFiles: [],
          didDropReactHooksJsPlugin: false,
          hadPartialFailure: false,
        };
      }
      // A file dropped by the binary-split retry (timeout / OOM) produces no
      // diagnostics — indistinguishable from a clean file by output alone. Track
      // it so the caller never caches a dropped file as a zero-finding hit.
      let hadPartialFailure = false;
      const reportPartialFailure = (reason: string): void => {
        hadPartialFailure = true;
        onPartialFailure?.(reason);
      };
      const passConfigPath = path.join(configDirectory, configFileName);
      const passBaseArgs = makeBaseArgs(passConfigPath);
      const passFileBatches = buildFileBatches(passBaseArgs, files);
      let analyzedFiles: ReadonlyArray<string> = [];
      const spawnPass = () => {
        analyzedFiles = [];
        return spawnLintBatches({
          baseArgs: passBaseArgs,
          fileBatches: passFileBatches,
          rootDirectory,
          nodeBinaryPath,
          project,
          onPartialFailure: reportPartialFailure,
          onAnalyzedFiles: (filePaths) => {
            analyzedFiles = filePaths;
          },
          onFileProgress: fileProgress,
          spawnTimeoutMs,
          outputMaxBytes,
          concurrency: options.concurrency,
          signal: options.signal,
          deadlineEpochMs: options.deadlineEpochMs,
        });
      };
      writeOxlintConfig(passConfigPath, buildConfigForPass({}));
      try {
        const diagnostics = await spawnPass();
        return {
          diagnostics,
          analyzedFiles,
          didDropReactHooksJsPlugin: false,
          hadPartialFailure,
        };
      } catch (error) {
        const reactHooksJsDropNote = reactHooksJsPluginDropNote(error);
        if (reactHooksJsDropNote === null) throw error;
        writeOxlintConfig(passConfigPath, buildConfigForPass({ disableReactHooksJsPlugin: true }));
        const diagnostics = await spawnPass();
        reportPartialFailure(reactHooksJsDropNote);
        return {
          diagnostics,
          analyzedFiles,
          didDropReactHooksJsPlugin: true,
          hadPartialFailure,
        };
      }
    };

    // The cache is sound only when nothing rewrites file content out from
    // under the content hash in a way the key can't see, and every linted rule
    // is one we can analyze:
    //   - adopted `extends` and user plugins carry opaque rules that may read
    //     other files, which a content-of-self key can't invalidate;
    //   - React Compiler (`react-hooks-js`) can fail to LOAD at lint time
    //     (issue #833) and get stripped mid-run. A warm scan with zero misses
    //     never spawns the cacheable pass, so that load failure would never
    //     trigger while stale React Compiler diagnostics keep replaying —
    //     breaking the byte-identical guarantee. Bypass entirely instead.
    // Any of those falls back to the original single-config path. Audit mode
    // (`!respectInlineDisables`) is NOT a bypass: its neutralize pass rewrites
    // disable directives on disk BEFORE the content is hashed (see the
    // `restoreDisableDirectives` HACK above), so the key already reflects what
    // oxlint saw, and `respectInlineDisables` is folded into the ruleset hash
    // so audit and default runs never share a cache entry.
    const useFileLintCache =
      perFileLintCacheEnabled &&
      !project.hasReactCompiler &&
      extendsPaths.length === 0 &&
      userPlugins.length === 0;

    if (useFileLintCache) {
      const rulesetHash = computeRulesetHash({
        config: buildConfig({ extendsPaths: [], ruleSelection: "cacheable" }),
        toolchainVersions: resolveOxlintToolchainVersions(nodeBinaryPath),
        ignorePatterns: combinedPatterns,
        tsconfigContent,
        respectInlineDisables,
      });
      const cache = createFileLintCache(resolveReactDoctorCacheDir(rootDirectory), rulesetHash);

      // Partition candidates by content hash. An unreadable file (no hash) is
      // treated as a miss and re-linted. Hashing reads every candidate's whole
      // content, so the loop yields on the cooperative time budget — otherwise
      // this pre-spawn burst starves the forked security-scan / supply-chain
      // fibers (and sibling projects) until the first oxlint spawn.
      const cacheKeyByFile = new Map<string, string>();
      // Canonical relative path → content hash, reused by the sidecar cache's
      // probe-answer resolver so verifying a source-file dependency is a map
      // lookup instead of a re-read.
      const contentHashByRelativePath = new Map<string, string>();
      const missFiles: string[] = [];
      const replayedDiagnostics: Diagnostic[] = [];
      let hashSliceStartedAt = performance.now();
      for (const candidateFile of candidateFiles) {
        const absoluteCandidatePath = path.resolve(rootDirectory, candidateFile);
        const contentHash = hashFileContents(absoluteCandidatePath);
        if (contentHash === null) {
          missFiles.push(candidateFile);
          continue;
        }
        contentHashByRelativePath.set(
          path.relative(rootDirectory, absoluteCandidatePath).replaceAll("\\", "/"),
          contentHash,
        );
        const cacheKey = `${candidateFile.replaceAll("\\", "/")}\u0000${contentHash}`;
        cacheKeyByFile.set(candidateFile, cacheKey);
        const cachedDiagnostics = cache.lookup(cacheKey);
        if (cachedDiagnostics === null) missFiles.push(candidateFile);
        else replayedDiagnostics.push(...cachedDiagnostics);
        if (performance.now() - hashSliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
          await yieldToEventLoop();
          hashSliceStartedAt = performance.now();
        }
      }
      const cacheHitFileCount = candidateFiles.length - missFiles.length;

      // The cross-file sidecar over the cache hits. The enabled sidecar rules
      // split by whether the plugin ships a dependency collector for them:
      //
      //   - BOUNDED rules replay from the sidecar cache: a hit file whose
      //     stored dependency probes all still match the tree replays its
      //     stored cross-file diagnostics; only mismatching (or unknown)
      //     files re-lint, in a sidecar pass narrowed to the bounded rules.
      //   - UNBOUNDED rules (no collector — see the plugin's
      //     `UNBOUNDED_CROSS_FILE_RULE_IDS`; empty today) can't be
      //     fingerprinted, so they run always-fresh over EVERY hit file in a
      //     second narrowed pass. The degradation is per-rule, not global.
      //
      // With the sidecar cache off (or no bounded rule enabled) the split
      // collapses to the pre-cache behavior: one always-fresh sidecar pass,
      // all cross-file rules, every hit file.
      const enabledSidecarRuleIds = Object.keys(
        buildConfig({ extendsPaths: [], ruleSelection: "sidecar" }).rules,
      )
        .map((ruleKey) => ruleKey.slice(ruleKey.lastIndexOf("/") + 1))
        .filter((ruleId) => CROSS_FILE_RULE_IDS.has(ruleId));
      const boundedSidecarRuleIds = enabledSidecarRuleIds.filter((ruleId) =>
        CROSS_FILE_DEPENDENCY_COLLECTORS.has(ruleId),
      );
      const boundedSidecarRuleIdSet: ReadonlySet<string> = new Set(boundedSidecarRuleIds);
      const unboundedSidecarRuleIds = enabledSidecarRuleIds.filter(
        (ruleId) => !CROSS_FILE_DEPENDENCY_COLLECTORS.has(ruleId),
      );
      const useSidecarCache = sidecarLintCacheEnabled && boundedSidecarRuleIds.length > 0;

      const sidecarCache = useSidecarCache
        ? createSidecarLintCache(
            resolveReactDoctorCacheDir(rootDirectory),
            computeRulesetHash({
              config: buildConfig({
                extendsPaths: [],
                ruleSelection: "sidecar",
                sidecarRuleIdFilter: boundedSidecarRuleIdSet,
              }),
              toolchainVersions: resolveOxlintToolchainVersions(nodeBinaryPath),
              ignorePatterns: combinedPatterns,
              tsconfigContent,
              respectInlineDisables,
            }),
          )
        : null;
      const probeAnswers = createSidecarProbeAnswerResolver({
        rootDirectory,
        contentHashByRelativePath,
      });
      // Started UNAWAITED so the in-process probe collection interleaves with
      // the full pass's child-process await below (the filesystem is frozen
      // for the scan, so collecting before/during/after the pass is
      // equivalent). Never rejects — a failing file maps to `null`.
      const missProbesTask =
        sidecarCache === null
          ? null
          : collectSidecarProbesForFiles({
              files: missFiles,
              rootDirectory,
              boundedSidecarRuleIds,
              probeAnswers,
            });

      // Miss files run the FULL config in one pass — cacheable and cross-file
      // rules together — and the cross-file sidecar covers only the cache
      // HITS. The previous shape (cacheable pass over misses, then sidecar
      // over every file) parsed and spawned over each miss twice, doubling
      // the lint cost of a cold-cache scan — every CI run. The fresh output
      // is partitioned by rule id below so only cacheable-rule diagnostics
      // are stored; cache contents and reported diagnostics are unchanged,
      // and a stale cross-file verdict still can't be served (hits replay
      // only behind matching dependency probes, misses ran the cross-file
      // rules in the full pass).
      const fullResult = await runConfigOverFiles(
        (overrides) =>
          buildConfig({
            extendsPaths: [],
            disableReactHooksJsPlugin: overrides.disableReactHooksJsPlugin,
          }),
        "oxlintrc.full.json",
        missFiles,
        options.onFileProgress &&
          ((scannedFileCount) => options.onFileProgress?.(scannedFileCount, candidateFiles.length)),
      );
      const missFileSet = new Set(missFiles);
      const hitFiles = candidateFiles.filter((candidateFile) => !missFileSet.has(candidateFile));

      // Split the hit files into replays and sidecar re-lints by re-answering
      // each stored probe against the current tree. Source-file answers are
      // map lookups over the hashes computed above; the loop still stats
      // package.json / tsconfig probes, so it shares the cooperative budget.
      const sidecarReplayedDiagnostics: Diagnostic[] = [];
      const sidecarReplayedFiles: string[] = [];
      const sidecarLintFiles: string[] = [];
      if (sidecarCache === null) {
        sidecarLintFiles.push(...hitFiles);
      } else {
        let verifySliceStartedAt = performance.now();
        for (const hitFile of hitFiles) {
          const cacheKey = cacheKeyByFile.get(hitFile);
          const entry = cacheKey === undefined ? null : sidecarCache.lookup(cacheKey);
          const isReplayable =
            entry !== null &&
            entry.probes.every(
              (probe) => probeAnswers.answerFor(probe.kind, probe.path) === probe.answer,
            );
          if (isReplayable) {
            sidecarReplayedFiles.push(hitFile);
            sidecarReplayedDiagnostics.push(...entry.diagnostics);
          } else sidecarLintFiles.push(hitFile);
          if (performance.now() - verifySliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
            await yieldToEventLoop();
            verifySliceStartedAt = performance.now();
          }
        }
      }

      // Same overlap as `missProbesTask`: collect the re-lint set's probes
      // while the bounded sidecar pass awaits its child processes.
      const sidecarProbesTask =
        sidecarCache === null
          ? null
          : collectSidecarProbesForFiles({
              files: sidecarLintFiles,
              rootDirectory,
              boundedSidecarRuleIds,
              probeAnswers,
            });
      // Replayed files are completed work: without them in the numerator the
      // spinner stalls at missFiles + sidecarLintFiles of candidateFiles, and
      // an all-replayed pass (empty sidecarLintFiles) would never tick at all.
      const sidecarReplayedFileCount = hitFiles.length - sidecarLintFiles.length;
      if (sidecarReplayedFileCount > 0) {
        options.onFileProgress?.(
          missFiles.length + sidecarReplayedFileCount,
          candidateFiles.length,
        );
      }
      const boundedSidecarResult = await runConfigOverFiles(
        () =>
          buildConfig({
            extendsPaths: [],
            ruleSelection: "sidecar",
            ...(useSidecarCache ? { sidecarRuleIdFilter: boundedSidecarRuleIdSet } : {}),
          }),
        "oxlintrc.sidecar.json",
        sidecarLintFiles,
        options.onFileProgress &&
          ((scannedFileCount) =>
            options.onFileProgress?.(
              missFiles.length + sidecarReplayedFileCount + scannedFileCount,
              candidateFiles.length,
            )),
      );
      const unboundedSidecarResult =
        useSidecarCache && unboundedSidecarRuleIds.length > 0
          ? await runConfigOverFiles(
              () =>
                buildConfig({
                  extendsPaths: [],
                  ruleSelection: "sidecar",
                  sidecarRuleIdFilter: new Set(unboundedSidecarRuleIds),
                }),
              "oxlintrc.sidecar-unbounded.json",
              hitFiles,
              undefined,
            )
          : {
              diagnostics: [],
              analyzedFiles: [],
              didDropReactHooksJsPlugin: false,
              hadPartialFailure: false,
            };

      const freshCacheableDiagnostics: Diagnostic[] = [];
      for (const diagnostic of fullResult.diagnostics) {
        if (!CROSS_FILE_RULE_IDS.has(diagnostic.rule)) freshCacheableDiagnostics.push(diagnostic);
      }

      // Reported only after every pass succeeds — if lint throws, the run
      // fails and no cache ratio is attached to a failed scan's telemetry.
      onCacheStats?.(cacheHitFileCount, candidateFiles.length);
      if (sidecarCache !== null) {
        onSidecarStats?.(hitFiles.length - sidecarLintFiles.length, hitFiles.length);
      }

      const freshDiagnosticsByFile = attributeDiagnosticsToFiles(
        freshCacheableDiagnostics,
        missFiles,
      );

      // Skip the store when this run can't be trusted to represent a clean,
      // complete lint of the miss files:
      //   - a react-hooks-js fallback rewrote the cacheable config, so its
      //     output no longer matches `rulesetHash`;
      //   - a partial failure dropped a file (timeout / OOM) — caching its
      //     empty output would mask the failure as a clean hit next scan;
      //   - the diagnostics couldn't be attributed back to their miss file.
      if (
        !fullResult.didDropReactHooksJsPlugin &&
        !fullResult.hadPartialFailure &&
        freshDiagnosticsByFile !== null
      ) {
        for (const missFile of missFiles) {
          const cacheKey = cacheKeyByFile.get(missFile);
          if (cacheKey !== undefined) {
            cache.store(cacheKey, freshDiagnosticsByFile.get(missFile) ?? []);
          }
        }
        cache.persist();
      }

      if (sidecarCache !== null && missProbesTask !== null && sidecarProbesTask !== null) {
        storeSidecarEntries({
          sidecarCache,
          cacheKeyByFile,
          storablePasses: [
            {
              files: sidecarLintFiles,
              diagnostics: boundedSidecarResult.diagnostics,
              isTrusted: !boundedSidecarResult.hadPartialFailure,
              probesByFile: await sidecarProbesTask,
            },
            {
              files: missFiles,
              diagnostics: fullResult.diagnostics.filter((diagnostic) =>
                boundedSidecarRuleIdSet.has(diagnostic.rule),
              ),
              isTrusted: !fullResult.didDropReactHooksJsPlugin && !fullResult.hadPartialFailure,
              probesByFile: await missProbesTask,
            },
          ],
        });
      }

      const analyzedFileSet = new Set(fullResult.analyzedFiles);
      const boundedSidecarAnalyzedFileSet = new Set(boundedSidecarResult.analyzedFiles);
      const unboundedSidecarAnalyzedFileSet = new Set(unboundedSidecarResult.analyzedFiles);
      const sidecarReplayedFileSet = new Set(sidecarReplayedFiles);
      for (const hitFile of hitFiles) {
        const didAnalyzeSidecar = useSidecarCache
          ? (sidecarReplayedFileSet.has(hitFile) || boundedSidecarAnalyzedFileSet.has(hitFile)) &&
            (unboundedSidecarRuleIds.length === 0 || unboundedSidecarAnalyzedFileSet.has(hitFile))
          : boundedSidecarAnalyzedFileSet.has(hitFile);
        if (didAnalyzeSidecar) analyzedFileSet.add(hitFile);
      }
      onFileCoverage?.({
        candidateFiles,
        analyzedFiles: candidateFiles.filter((candidateFile) => analyzedFileSet.has(candidateFile)),
      });

      // Dedupe the merged result to match the non-cached path (which dedupes
      // at the end of `spawnLintBatches`): a duplicate path in `includePaths`
      // replays the same cached set twice, which dedupe collapses — so warm
      // output stays equal to a cache-off scan of the same inputs.
      return dedupeDiagnostics([
        ...replayedDiagnostics,
        ...fullResult.diagnostics,
        ...sidecarReplayedDiagnostics,
        ...boundedSidecarResult.diagnostics,
        ...unboundedSidecarResult.diagnostics,
      ]);
    }

    const baseArgs = makeBaseArgs(configPath);
    const fileBatches = buildFileBatches(baseArgs, candidateFiles);
    let analyzedFiles: ReadonlyArray<string> = [];

    const runBatches = () =>
      spawnLintBatches({
        baseArgs,
        fileBatches,
        rootDirectory,
        nodeBinaryPath,
        project,
        onPartialFailure,
        onAnalyzedFiles: (filePaths) => {
          analyzedFiles = filePaths;
        },
        onFileProgress: options.onFileProgress,
        spawnTimeoutMs,
        outputMaxBytes,
        concurrency: options.concurrency,
        signal: options.signal,
        deadlineEpochMs: options.deadlineEpochMs,
      });

    writeOxlintConfig(configPath, buildConfig({ extendsPaths }));
    try {
      const diagnostics = await runBatches();
      onFileCoverage?.({ candidateFiles, analyzedFiles });
      return diagnostics;
    } catch (error) {
      // The optional `react-hooks-js` React Compiler plugin failed to
      // `import()` in this environment. oxlint fails the ENTIRE config
      // load on it, which would otherwise drop every curated
      // react-doctor diagnostic too. Retry once with the plugin stripped
      // so the rest of the scan still runs; the React Compiler rules are
      // the only casualty, and the user is told why via a partial
      // failure (issue #833). Reported only after the retry succeeds, so
      // a still-failing scan surfaces the original error untouched.
      const reactHooksJsDropNote = reactHooksJsPluginDropNote(error);
      if (reactHooksJsDropNote !== null) {
        writeOxlintConfig(
          configPath,
          buildConfig({ extendsPaths, disableReactHooksJsPlugin: true }),
        );
        const diagnostics = await runBatches();
        onPartialFailure?.(reactHooksJsDropNote);
        onFileCoverage?.({ candidateFiles, analyzedFiles });
        return diagnostics;
      }
      // HACK: if the user's adopted lint config is the reason oxlint
      // crashed (broken JSON, missing plugin, unknown rule), failing
      // the entire lint pass would leave the user with a 100/100
      // score off zero diagnostics — a worse outcome than running
      // our curated rules without their extras. Retry once without
      // `extends` and keep the scan useful. The retry is silent:
      // mid-output stderr warning was noisy enough that users took
      // it as react-doctor itself crashing; the curated-rules scan
      // is the graceful path.
      if (extendsPaths.length === 0) throw error;
      // `buildConfig({ extendsPaths: [] })` carries every other option
      // through — most importantly `userPlugins`, so custom rules from
      // `config.plugins` still run on the retry.
      writeOxlintConfig(configPath, buildConfig({ extendsPaths: [] }));
      const diagnostics = await runBatches();
      onFileCoverage?.({ candidateFiles, analyzedFiles });
      return diagnostics;
    }
  } finally {
    restoreDisableDirectives();
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
};
