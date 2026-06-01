import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "./types/index.js";
import { batchIncludePaths } from "./batch-include-paths.js";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import { canOxlintExtendConfig } from "./can-oxlint-extend-config.js";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { detectUserLintConfigPaths } from "./detect-user-lint-config.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";
import { createOxlintConfig } from "./runners/oxlint/config.js";
import { resolveUserPlugins } from "./runners/oxlint/plugin-resolution.js";
import {
  resolveOxlintBinary,
  resolvePluginPath,
  resolveTsConfigRelativePath,
} from "./runners/oxlint/resolve-paths.js";
import { spawnLintBatches } from "./runners/oxlint/spawn-batches.js";
import { validateRuleRegistration } from "./runners/oxlint/validate-rule-registration.js";
import { listSourceFiles } from "./utils/list-source-files.js";

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
    spawnTimeoutMs,
    outputMaxBytes,
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

  const buildConfig = (extendsForThisAttempt: string[]) =>
    createOxlintConfig({
      pluginPath,
      project,
      customRulesOnly,
      extendsPaths: extendsForThisAttempt,
      ignoredTags,
      serverAuthFunctionNames,
      severityControls,
      userPlugins,
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
    const baseArgs = [oxlintBinary, "-c", configPath, "--format", "json"];

    if (project.hasTypeScript) {
      const tsconfigRelativePath = resolveTsConfigRelativePath(rootDirectory);
      if (tsconfigRelativePath) {
        baseArgs.push("--tsconfig", tsconfigRelativePath);
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
      baseArgs.push("--ignore-path", combinedIgnorePath);
    }

    // HACK: when `includePaths` is undefined we used to pass `["."]`
    // and let oxlint walk the tree itself. That defeated batching
    // entirely — verified on supabase/studio (3567 source files)
    // that JS-plugin rules hit the 5-min `OXLINT_SPAWN_TIMEOUT_MS`
    // in a single batch, leaving `skippedChecks: ["lint"]` and zero
    // diagnostics. Materializing the file list ahead of time and
    // feeding it through `batchIncludePaths` keeps each spawn under
    // the timeout and recovers the diagnostics we were dropping.
    const fileBatches = batchIncludePaths(
      baseArgs,
      includePaths !== undefined ? includePaths : listSourceFiles(rootDirectory),
    );

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
      });

    writeOxlintConfig(configPath, buildConfig(extendsPaths));
    try {
      return await runBatches();
    } catch (error) {
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
      // `buildConfig([])` carries every other option through — most
      // importantly `userPlugins`, so custom rules from
      // `config.plugins` still run on the retry.
      writeOxlintConfig(configPath, buildConfig([]));
      return await runBatches();
    }
  } finally {
    restoreDisableDirectives();
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
};
