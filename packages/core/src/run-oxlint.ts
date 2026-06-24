import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "./types/index.js";
import { batchIncludePaths } from "./batch-include-paths.js";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import { canOxlintExtendConfig } from "./can-oxlint-extend-config.js";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { detectUserLintConfigPaths } from "./detect-user-lint-config.js";
import { ReactDoctorError } from "./errors.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";
import { computeRulesetHash } from "./runners/oxlint/compute-ruleset-hash.js";
import { createOxlintConfig } from "./runners/oxlint/config.js";
import { createFileLintCache } from "./runners/oxlint/file-lint-cache.js";
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
import { listSourceFiles, listSourceFilesWithSize } from "./utils/list-source-files.js";
import { resolveReactDoctorCacheDir } from "./utils/resolve-react-doctor-cache-dir.js";
import { sortSourceFilesByCost } from "./utils/sort-source-files-by-cost.js";

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
  onFileProgress?: (scannedFileCount: number, totalFileCount: number) => void;
  /**
   * Enables the per-file lint cache, resolved from the
   * `PerFileLintCacheEnabled` Reference. When on (and the scan is eligible —
   * no audit mode, no adopted `extends`, no user plugins), unchanged files
   * replay their cached cacheable-rule diagnostics and only changed files are
   * re-linted; the cross-file rules always run fresh in a sidecar pass.
   */
  perFileLintCacheEnabled?: boolean;
  /**
   * Called once after the cache split with `(cacheHitFileCount,
   * totalConsideredFileCount)`. Surfaced to the Sentry wide event as
   * `lintCacheHitRatio`. Not invoked when the cache is disabled or bypassed.
   */
  onCacheStats?: (cacheHitFileCount: number, totalConsideredFileCount: number) => void;
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
  /**
   * Full-scan batch ordering, resolved from the `LintBatchOrdering`
   * Reference. `"arrival"` (the default) keeps discovery order; `"cost"`
   * opts into LPT (largest files first). Only affects the full-scan branch
   * (`includePaths` undefined) — diff / staged scans pass explicit paths and
   * are untouched.
   */
  lintBatchOrdering?: "cost" | "arrival";
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
    perFileLintCacheEnabled = false,
    onCacheStats,
    spawnTimeoutMs,
    outputMaxBytes,
    lintBatchOrdering = "arrival",
  } = options;

  const serverAuthFunctionNames = Array.isArray(userConfig?.serverAuthFunctionNames)
    ? userConfig.serverAuthFunctionNames.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      )
    : undefined;
  const severityControls = buildRuleSeverityControls(userConfig);

  validateRuleRegistration();

  if (includePaths !== undefined && includePaths.length === 0) {
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
    // feeding it through `batchIncludePaths` keeps each spawn under
    // the timeout and recovers the diagnostics we were dropping.
    //
    // `"cost"` orders discovered files largest-first (LPT) so the
    // heaviest batch starts in wave 1 of the parallel pool instead of
    // stranding in the tail — the size is the minified gate's existing
    // stat, captured rather than re-paid. `"arrival"` (the default) keeps
    // discovery order; `cost` is the env opt-in (`LintBatchOrdering`). Only
    // invoked for a full scan, so diff / staged scans never pay the walk.
    const discoverScanFiles = (): string[] =>
      lintBatchOrdering === "cost"
        ? sortSourceFilesByCost(listSourceFilesWithSize(rootDirectory))
        : listSourceFiles(rootDirectory);

    const candidateFiles = includePaths !== undefined ? includePaths : discoverScanFiles();

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
      didDropReactHooksJsPlugin: boolean;
      hadPartialFailure: boolean;
    }> => {
      if (files.length === 0) {
        return { diagnostics: [], didDropReactHooksJsPlugin: false, hadPartialFailure: false };
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
      const passFileBatches = batchIncludePaths(passBaseArgs, files);
      const spawnPass = () =>
        spawnLintBatches({
          baseArgs: passBaseArgs,
          fileBatches: passFileBatches,
          rootDirectory,
          nodeBinaryPath,
          project,
          onPartialFailure: reportPartialFailure,
          onFileProgress: fileProgress,
          spawnTimeoutMs,
          outputMaxBytes,
          concurrency: options.concurrency,
          signal: options.signal,
        });
      writeOxlintConfig(passConfigPath, buildConfigForPass({}));
      try {
        const diagnostics = await spawnPass();
        return { diagnostics, didDropReactHooksJsPlugin: false, hadPartialFailure };
      } catch (error) {
        const reactHooksJsDropNote = reactHooksJsPluginDropNote(error);
        if (reactHooksJsDropNote === null) throw error;
        writeOxlintConfig(passConfigPath, buildConfigForPass({ disableReactHooksJsPlugin: true }));
        const diagnostics = await spawnPass();
        reportPartialFailure(reactHooksJsDropNote);
        return { diagnostics, didDropReactHooksJsPlugin: true, hadPartialFailure };
      }
    };

    // The cache is sound only when nothing rewrites file content out from
    // under the content hash and every linted rule is one we can analyze:
    //   - audit mode (`!respectInlineDisables`) mutates files in place, so the
    //     hash wouldn't match what oxlint saw;
    //   - adopted `extends` and user plugins carry opaque rules that may read
    //     other files, which a content-of-self key can't invalidate;
    //   - React Compiler (`react-hooks-js`) can fail to LOAD at lint time
    //     (issue #833) and get stripped mid-run. A warm scan with zero misses
    //     never spawns the cacheable pass, so that load failure would never
    //     trigger while stale React Compiler diagnostics keep replaying —
    //     breaking the byte-identical guarantee. Bypass entirely instead.
    // Any of those falls back to the original single-config path.
    const useFileLintCache =
      perFileLintCacheEnabled &&
      respectInlineDisables &&
      !project.hasReactCompiler &&
      extendsPaths.length === 0 &&
      userPlugins.length === 0;

    if (useFileLintCache) {
      const rulesetHash = computeRulesetHash({
        config: buildConfig({ extendsPaths: [], ruleSelection: "cacheable" }),
        toolchainVersions: resolveOxlintToolchainVersions(),
        ignorePatterns: combinedPatterns,
        tsconfigContent,
      });
      const cache = createFileLintCache(resolveReactDoctorCacheDir(rootDirectory), rulesetHash);

      // Partition candidates by content hash. An unreadable file (no hash) is
      // treated as a miss and re-linted.
      const cacheKeyByFile = new Map<string, string>();
      const missFiles: string[] = [];
      const replayedDiagnostics: Diagnostic[] = [];
      for (const candidateFile of candidateFiles) {
        const contentHash = hashFileContents(path.resolve(rootDirectory, candidateFile));
        if (contentHash === null) {
          missFiles.push(candidateFile);
          continue;
        }
        const cacheKey = `${candidateFile.replaceAll("\\", "/")} ${contentHash}`;
        cacheKeyByFile.set(candidateFile, cacheKey);
        const cachedDiagnostics = cache.lookup(cacheKey);
        if (cachedDiagnostics === null) missFiles.push(candidateFile);
        else replayedDiagnostics.push(...cachedDiagnostics);
      }
      const cacheHitFileCount = candidateFiles.length - missFiles.length;

      // Cacheable rules re-run only on changed files; the cross-file sidecar
      // always runs fresh on EVERY file so a dependency change can never serve
      // a stale cross-file verdict for an unchanged file.
      const cacheableResult = await runConfigOverFiles(
        (overrides) =>
          buildConfig({
            extendsPaths: [],
            ruleSelection: "cacheable",
            disableReactHooksJsPlugin: overrides.disableReactHooksJsPlugin,
          }),
        "oxlintrc.cacheable.json",
        missFiles,
        undefined,
      );
      const sidecarResult = await runConfigOverFiles(
        () => buildConfig({ extendsPaths: [], ruleSelection: "sidecar" }),
        "oxlintrc.sidecar.json",
        candidateFiles,
        options.onFileProgress,
      );

      // Reported only after both passes succeed — if lint throws, the run fails
      // and no cache-hit ratio is attached to a failed scan's telemetry.
      onCacheStats?.(cacheHitFileCount, candidateFiles.length);

      // Attribute fresh cacheable diagnostics back to their miss file by the
      // normalized path oxlint echoes. If ANY diagnostic can't be attributed,
      // the path forms don't align — skip the store rather than risk caching a
      // wrong empty result for a file that actually had diagnostics.
      const missFileByNormalizedPath = new Map<string, string>();
      for (const missFile of missFiles) {
        missFileByNormalizedPath.set(missFile.replaceAll("\\", "/"), missFile);
      }
      const freshDiagnosticsByFile = new Map<string, Diagnostic[]>();
      let isAttributionSound = true;
      for (const diagnostic of cacheableResult.diagnostics) {
        const missFile = missFileByNormalizedPath.get(diagnostic.filePath);
        if (missFile === undefined) {
          isAttributionSound = false;
          break;
        }
        const fileDiagnostics = freshDiagnosticsByFile.get(missFile) ?? [];
        fileDiagnostics.push(diagnostic);
        freshDiagnosticsByFile.set(missFile, fileDiagnostics);
      }

      // Skip the store when this run can't be trusted to represent a clean,
      // complete lint of the miss files:
      //   - a react-hooks-js fallback rewrote the cacheable config, so its
      //     output no longer matches `rulesetHash`;
      //   - a partial failure dropped a file (timeout / OOM) — caching its
      //     empty output would mask the failure as a clean hit next scan;
      //   - the diagnostics couldn't be attributed back to their miss file.
      if (
        !cacheableResult.didDropReactHooksJsPlugin &&
        !cacheableResult.hadPartialFailure &&
        isAttributionSound
      ) {
        for (const missFile of missFiles) {
          const cacheKey = cacheKeyByFile.get(missFile);
          if (cacheKey !== undefined) {
            cache.store(cacheKey, freshDiagnosticsByFile.get(missFile) ?? []);
          }
        }
        cache.persist();
      }

      // Dedupe the merged result to match the non-cached path (which dedupes
      // at the end of `spawnLintBatches`): a duplicate path in `includePaths`
      // replays the same cached set twice, which dedupe collapses — so warm
      // output stays equal to a cache-off scan of the same inputs.
      return dedupeDiagnostics([
        ...replayedDiagnostics,
        ...cacheableResult.diagnostics,
        ...sidecarResult.diagnostics,
      ]);
    }

    const baseArgs = makeBaseArgs(configPath);
    const fileBatches = batchIncludePaths(baseArgs, candidateFiles);

    const runBatches = () =>
      spawnLintBatches({
        baseArgs,
        fileBatches,
        rootDirectory,
        nodeBinaryPath,
        project,
        onPartialFailure,
        onFileProgress: options.onFileProgress,
        spawnTimeoutMs,
        outputMaxBytes,
        concurrency: options.concurrency,
        signal: options.signal,
      });

    writeOxlintConfig(configPath, buildConfig({ extendsPaths }));
    try {
      return await runBatches();
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
      return await runBatches();
    }
  } finally {
    restoreDisableDirectives();
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
};
