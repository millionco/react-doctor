import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  ERROR_PREVIEW_LENGTH_CHARS,
  OXLINT_OUTPUT_MAX_BYTES,
  SOURCE_FILE_PATTERN,
} from "./constants.js";
import { batchIncludePaths } from "./batch-include-paths.js";
import { canOxlintExtendConfig } from "./can-oxlint-extend-config.js";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { detectUserLintConfigPaths } from "./detect-user-lint-config.js";
import { dedupeDiagnostics } from "./utils/dedupe-diagnostics.js";
import { listSourceFiles } from "./utils/list-source-files.js";
import { createOxlintConfig } from "./runners/oxlint/config.js";
import { shouldSuppressLocalUseHookDiagnostic } from "./runners/oxlint/should-suppress-local-use-hook-diagnostic.js";
import reactDoctorPlugin, {
  ALL_REACT_DOCTOR_RULE_KEYS,
  FRAMEWORK_SPECIFIC_RULE_KEYS,
} from "oxlint-plugin-react-doctor";
import type {
  CleanedDiagnostic,
  Diagnostic,
  OxlintOutput,
  ProjectInfo,
  ReactDoctorConfig,
} from "@react-doctor/types";
import { buildNoSecretsRecommendation } from "./utils/build-no-secrets-recommendation.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";

const getRuleRecommendation = (ruleName: string, project: ProjectInfo): string | undefined => {
  if (ruleName === "no-secrets-in-client-code") {
    return buildNoSecretsRecommendation(
      project,
      reactDoctorPlugin.rules["no-secrets-in-client-code"]?.recommendation ??
        "Move secrets to server-only code",
    );
  }
  return reactDoctorPlugin.rules[ruleName]?.recommendation;
};

// Same shape as `getRuleRecommendation`, but for the diagnostic category
// (`State & Effects`, `Performance`, …) the rule rolls up under in the
// scan summary. Used by `resolveDiagnosticCategory` below and by
// `validateRuleRegistration` to assert per-rule metadata coverage.
const getRuleCategory = (ruleName: string): string | undefined =>
  reactDoctorPlugin.rules[ruleName]?.category;

const esmRequire = createRequire(import.meta.url);

const PLUGIN_CATEGORY_MAP: Record<string, string> = {
  react: "Correctness",
  "react-hooks": "Correctness",
  "react-hooks-js": "React Compiler",
  "react-doctor": "Other",
  "jsx-a11y": "Accessibility",
  effect: "State & Effects",
  // Plugins users commonly enable in their own oxlint / eslint config
  // and that react-doctor folds into the scan via `extends`. Sensible
  // defaults so adopted-rule diagnostics don't all collapse into the
  // generic "Other" bucket in the output grouping.
  eslint: "Correctness",
  oxc: "Correctness",
  typescript: "Correctness",
  unicorn: "Correctness",
  import: "Bundle Size",
  promise: "Correctness",
  n: "Correctness",
  node: "Correctness",
  vitest: "Correctness",
  jest: "Correctness",
  nextjs: "Next.js",
};

const FILEPATH_WITH_LOCATION_PATTERN = /\S+\.\w+:\d+:\d+[\s\S]*$/;

const REACT_COMPILER_MESSAGE = "React Compiler can't optimize this code";

// HACK: `Object.hasOwn` guards against falling through to
// `Object.prototype` when oxlint emits a rule whose name happens to
// shadow a base Object property (`constructor`, `toString`, …). Without
// the guard the rule's help text would render as
// `function Object() { [native code] }`. Same defense applied to the
// plugin-/rule-category lookups below.
const lookupOwnString = (record: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const cleanDiagnosticMessage = (
  message: string,
  help: string,
  plugin: string,
  rule: string,
  project: ProjectInfo,
): CleanedDiagnostic => {
  if (plugin === "react-hooks-js") {
    const rawMessage = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
    return { message: REACT_COMPILER_MESSAGE, help: rawMessage || help };
  }
  const cleaned = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
  return {
    message: cleaned || message,
    help: help || getRuleRecommendation(rule, project) || "",
  };
};

const parseRuleCode = (code: string): { plugin: string; rule: string } => {
  const match = code.match(/^(.+)\((.+)\)$/);
  if (!match) return { plugin: "unknown", rule: code };
  return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const resolveOxlintBinary = (): string => {
  const oxlintMainPath = esmRequire.resolve("oxlint");
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

// Oxlint loads JS plugins by file path (`await import(specifier)`). We resolve
// the installed `oxlint-plugin-react-doctor` package's main entry — it ships a
// default-exported plugin module that oxlint accepts as-is. This works in dev
// (workspace symlink), in npm installs (node_modules/.pnpm/...), and from
// pnpm dlx / npx temp directories.
const resolvePluginPath = (): string => esmRequire.resolve("oxlint-plugin-react-doctor");

const resolveDiagnosticCategory = (plugin: string, rule: string): string =>
  getRuleCategory(rule) ?? lookupOwnString(PLUGIN_CATEGORY_MAP, plugin) ?? "Other";

// HACK: Sanitize child env so a developer's NODE_OPTIONS=--inspect (or
// --max-old-space-size=128, etc.) doesn't leak into oxlint and either spawn a
// debugger port or starve it of memory. We also drop npm_config_* lifecycle
// vars to keep oxlint from picking up package-manager state. PATH, HOME,
// NODE_ENV, NODE_PATH, etc. pass through unchanged.
const SANITIZED_ENV: NodeJS.ProcessEnv = (() => {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "NODE_OPTIONS" || name === "NODE_DEBUG") continue;
    if (name.startsWith("npm_config_")) continue;
    sanitized[name] = value;
  }
  return sanitized;
})();

// HACK: per-batch (NOT per-project) wall-clock budget. Each batch is
// at most `OXLINT_MAX_FILES_PER_BATCH` (= 100) files, and a healthy
// batch finishes in well under a second on every project in the eval
// corpus. 60s leaves an enormous safety margin; anything longer is a
// signal that ONE specific file or rule has runaway behavior on the
// shape of this project. Combined with the binary-split recovery in
// `spawnLintBatches`, large pathological batches now narrow down to
// the single offending file rather than killing the whole scan as
// the previous 5-min budget did on supabase/studio.
const OXLINT_SPAWN_TIMEOUT_MS = 60_000;

const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  nodeBinaryPath: string,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
      env: SANITIZED_ENV,
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      // HACK: message string is grepped by `isSplittableOxlintBatchError`
      // — keep "did not return within" in the prefix.
      reject(
        new Error(
          `oxlint did not return within ${OXLINT_SPAWN_TIMEOUT_MS / 1000}s — please report`,
        ),
      );
    }, OXLINT_SPAWN_TIMEOUT_MS);
    timeoutHandle.unref?.();

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    let stdoutByteCount = 0;
    let stderrByteCount = 0;
    let didKillForSize = false;

    const killIfTooLarge = (incomingBytes: number, isStdout: boolean): boolean => {
      if (isStdout) {
        stdoutByteCount += incomingBytes;
      } else {
        stderrByteCount += incomingBytes;
      }
      if (stdoutByteCount + stderrByteCount > OXLINT_OUTPUT_MAX_BYTES && !didKillForSize) {
        didKillForSize = true;
        child.kill("SIGKILL");
        return true;
      }
      return false;
    };

    child.stdout.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stdoutBuffers.push(buffer);
      killIfTooLarge(buffer.length, true);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stderrBuffers.push(buffer);
      killIfTooLarge(buffer.length, false);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to run oxlint: ${error.message}`));
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timeoutHandle);
      if (didKillForSize) {
        reject(
          new Error(
            `oxlint output exceeded ${OXLINT_OUTPUT_MAX_BYTES} bytes — scan a smaller subset with --diff or --staged`,
          ),
        );
        return;
      }
      if (signal) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        const hint =
          signal === "SIGABRT" ? " (out of memory — try scanning fewer files with --diff)" : "";
        const detail = stderrOutput ? `: ${stderrOutput}` : "";
        reject(new Error(`oxlint was killed by ${signal}${hint}${detail}`));
        return;
      }
      const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
      if (!output) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        if (stderrOutput) {
          reject(new Error(`Failed to run oxlint: ${stderrOutput}`));
          return;
        }
      }
      resolve(output);
    });
  });

const isSplittableOxlintBatchError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("did not return within") ||
    error.message.includes("output exceeded") ||
    error.message.includes("out of memory")
  );
};

const isOxlintOutput = (value: unknown): value is OxlintOutput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { diagnostics?: unknown };
  return Array.isArray(candidate.diagnostics);
};

const parseOxlintOutput = (
  stdout: string,
  project: ProjectInfo,
  rootDirectory: string,
): Diagnostic[] => {
  if (!stdout) return [];

  // HACK: oxlint sometimes prepends a notice line to stdout (e.g. when
  // every input was ignored — "No files found to lint. Please check…").
  // Skip any leading non-JSON noise by jumping to the first `{` we see;
  // the remainder is the actual report. Locale- and wording-agnostic.
  const jsonStart = stdout.indexOf("{");
  const sanitizedStdout = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizedStdout);
  } catch {
    throw new Error(
      `Failed to parse oxlint output: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }

  if (!isOxlintOutput(parsed)) {
    throw new Error(
      `Unexpected oxlint output shape: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }
  const output = parsed;

  // HACK: oxlint reports diagnostics for every JS/TS extension it
  // scanned (`.ts`, `.tsx`, `.js`, `.jsx`). The previous filter only
  // kept `.tsx` / `.jsx` — fine when react-doctor's curated rules were
  // the only sources (they're React-specific anyway), but adopted
  // user rules like `eslint/no-debugger` or `unicorn/*` typically
  // fire on plain `.ts` / `.js` files; dropping those silently
  // erased their score impact. SOURCE_FILE_PATTERN matches the same
  // extensions we count as source files everywhere else.
  return output.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code &&
        SOURCE_FILE_PATTERN.test(diagnostic.filename) &&
        !shouldSuppressLocalUseHookDiagnostic(diagnostic, rootDirectory),
    )
    .map((diagnostic) => {
      const { plugin, rule } = parseRuleCode(diagnostic.code);
      const primaryLabel = diagnostic.labels[0];

      const cleaned = cleanDiagnosticMessage(
        diagnostic.message,
        diagnostic.help,
        plugin,
        rule,
        project,
      );

      return {
        filePath: diagnostic.filename,
        plugin,
        rule,
        severity: diagnostic.severity,
        message: cleaned.message,
        help: cleaned.help,
        url: diagnostic.url,
        line: primaryLabel?.span.line ?? 0,
        column: primaryLabel?.span.column ?? 0,
        category: resolveDiagnosticCategory(plugin, rule),
      };
    });
};

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const resolveTsConfigRelativePath = (rootDirectory: string): string | null => {
  for (const filename of TSCONFIG_FILENAMES) {
    if (fs.existsSync(path.join(rootDirectory, filename))) {
      return `./${filename}`;
    }
  }
  return null;
};

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
   * provided, project-level knobs the rule surface honors — currently
   * `serverAuthFunctionNames` — are forwarded to the generated oxlint
   * settings so plugin rules can read them via `context.settings`.
   */
  userConfig?: ReactDoctorConfig | null;
  /**
   * Called once per soft-fail event (e.g. a batch hit
   * `OXLINT_SPAWN_TIMEOUT_MS` and was skipped). The lint scan keeps
   * going on remaining batches; the caller is expected to surface the
   * warning to the user (via `skippedCheckReasons` in JSON mode, or
   * a logger message in human mode).
   */
  onPartialFailure?: (reason: string) => void;
}

let didValidateRuleRegistration = false;

const validateRuleRegistration = (): void => {
  if (didValidateRuleRegistration) return;
  didValidateRuleRegistration = true;
  const missingHelp: string[] = [];
  const missingCategory: string[] = [];
  const missingMetadata: string[] = [];
  for (const fullKey of ALL_REACT_DOCTOR_RULE_KEYS) {
    const ruleName = fullKey.replace(/^react-doctor\//, "");
    if (!getRuleCategory(ruleName)) {
      missingCategory.push(fullKey);
    }
    if (!reactDoctorPlugin.rules[ruleName]?.recommendation) {
      missingHelp.push(fullKey);
    }
    if (FRAMEWORK_SPECIFIC_RULE_KEYS.has(fullKey) && !reactDoctorPlugin.rules[ruleName]?.requires) {
      missingMetadata.push(fullKey);
    }
  }
  if (missingCategory.length > 0 || missingHelp.length > 0 || missingMetadata.length > 0) {
    const detail = [
      missingCategory.length > 0
        ? `Missing rule categories (add to defineRule call): ${missingCategory.join(", ")}`
        : null,
      missingHelp.length > 0
        ? `Missing rule recommendations (add to defineRule call): ${missingHelp.join(", ")}`
        : null,
      missingMetadata.length > 0
        ? `Missing rule \`requires\` capability gate (add to defineRule call): ${missingMetadata.join(", ")}`
        : null,
    ]
      .filter((entry): entry is string => entry !== null)
      .join("; ");
    // HACK: warn rather than throw — never block the user's scan over a metadata gap.
    console.warn(`[react-doctor] rule-registration drift: ${detail}`);
  }
};

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
    onPartialFailure,
  } = options;

  const serverAuthFunctionNames = Array.isArray(userConfig?.serverAuthFunctionNames)
    ? userConfig.serverAuthFunctionNames.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      )
    : undefined;

  validateRuleRegistration();

  if (includePaths !== undefined && includePaths.length === 0) {
    return [];
  }

  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxlintrc-"));
  const configPath = path.join(configDirectory, "oxlintrc.json");
  const pluginPath = resolvePluginPath();
  // HACK: pass user lint configs to oxlint as absolute paths. oxlint's
  // docs say `extends` is "resolved relative to the configuration file
  // that declares extends," but a literal `path.relative(configDir, ...)`
  // breaks when the OS resolves symlinked tmp dirs (e.g. macOS's
  // `/var/folders/.../T/...` actually lives under `/private/var/...`,
  // so a `../../../...` walk from the symlink view doesn't equal the
  // same walk from the canonical view and oxlint's NotFound errors
  // out). Absolute paths sidestep the whole symlink dance — oxlint
  // accepts them and they're stable across runtimes. We skip extends
  // entirely under `customRulesOnly` because that mode opts out of
  // every rule outside the react-doctor plugin.
  const detectedConfigPaths =
    adoptExistingLintConfig && !customRulesOnly ? detectUserLintConfigPaths(rootDirectory) : [];
  // HACK: filter out `.eslintrc.json` files whose `extends` lists only
  // bare-package refs (`"next"`, `"airbnb"`, `"plugin:foo/bar"`). oxlint's
  // resolver can't follow those — adopting them guarantees the parser
  // crash + misleading "could not adopt existing lint config" warning.
  // Drop them up front so the scan starts in the same state the fallback
  // would land in, with no stderr noise.
  const extendsPaths = detectedConfigPaths.filter(canOxlintExtendConfig);
  const config = createOxlintConfig({
    pluginPath,
    project,
    customRulesOnly,
    extendsPaths,
    ignoredTags,
    serverAuthFunctionNames,
  });
  // HACK: only neutralize disable comments in audit mode. Default
  // behavior respects the user's existing `// eslint-disable*` /
  // `// oxlint-disable*` directives — we let oxlint apply them.
  const restoreDisableDirectives = respectInlineDisables
    ? () => {}
    : neutralizeDisableDirectives(rootDirectory, includePaths);

  try {
    const oxlintBinary = resolveOxlintBinary();
    const baseArgs = [oxlintBinary, "-c", configPath, "--format", "json"];

    if (project.hasTypeScript) {
      const tsconfigRelativePath = resolveTsConfigRelativePath(rootDirectory);
      if (tsconfigRelativePath) {
        baseArgs.push("--tsconfig", tsconfigRelativePath);
      }
    }

    // HACK: pass every ignore source via a single combined `--ignore-path`
    // file (cheap on `baseArgs` length) rather than N `--ignore-pattern`
    // entries (which would inflate per-batch arg length and shrink the
    // file-count budget on large diffs). The combined file MUST include
    // `.eslintignore` patterns because `--ignore-path` overrides oxlint's
    // automatic `.eslintignore` lookup — that responsibility now lives
    // in `collectIgnorePatterns`.
    const combinedPatterns = collectIgnorePatterns(rootDirectory);
    if (combinedPatterns.length > 0) {
      const combinedIgnorePath = path.join(configDirectory, "combined.ignore");
      fs.writeFileSync(combinedIgnorePath, `${combinedPatterns.join("\n")}\n`);
      baseArgs.push("--ignore-path", combinedIgnorePath);
    }

    // HACK: when `includePaths` is undefined we used to pass `["."]` and
    // let oxlint walk the tree itself. That defeated batching entirely
    // — verified on supabase/studio (3567 source files) that JS-plugin
    // rules (notably `eslint-plugin-react-you-might-not-need-an-effect`)
    // hit the 5-min `OXLINT_SPAWN_TIMEOUT_MS` in a single batch, leaving
    // `skippedChecks: ["lint"]` and zero diagnostics for the entire
    // project. Materializing the file list ahead of time and feeding
    // it through `batchIncludePaths` keeps each spawn under the timeout
    // (~7-8s per 100-file batch on studio) and recovers the diagnostics
    // we were silently dropping.
    const fileBatches = batchIncludePaths(
      baseArgs,
      includePaths !== undefined ? includePaths : listSourceFiles(rootDirectory),
    );

    const writeOxlintConfig = (configToWrite: ReturnType<typeof createOxlintConfig>): void => {
      // HACK: fs.rm + open(wx) (instead of plain open(w)) so we keep
      // the original "fail if a stale file exists at this exact path"
      // safety net while still allowing the retry-without-extends
      // fallback below to overwrite our own config in place.
      fs.rmSync(configPath, { force: true });
      const fileHandle = fs.openSync(configPath, "wx", 0o600);
      try {
        fs.writeFileSync(fileHandle, JSON.stringify(configToWrite));
      } finally {
        fs.closeSync(fileHandle);
      }
    };

    const spawnLintBatches = async (): Promise<Diagnostic[]> => {
      const allDiagnostics: Diagnostic[] = [];
      // HACK: tracks files whose smallest splittable batch (down to a
      // single file) still failed with a splittable error — surfaced
      // via `onPartialFailure` so JSON consumers see WHICH files were
      // dropped instead of silently losing them. Compose with the
      // binary-split below: large batches that time out / OOM split in
      // half and retry; the only files that reach this set are the
      // genuinely-pathological ones (e.g. one file × one quadratic
      // JS-plugin rule, like supabase/studio's `apps/studio/pages/...`
      // bucket against `eslint-plugin-react-you-might-not-need-an-effect`).
      const droppedFiles: string[] = [];

      const spawnLintBatch = async (batch: string[]): Promise<Diagnostic[]> => {
        const batchArgs = [...baseArgs, ...batch];
        try {
          const stdout = await spawnOxlint(batchArgs, rootDirectory, nodeBinaryPath);
          return parseOxlintOutput(stdout, project, rootDirectory);
        } catch (error) {
          if (!isSplittableOxlintBatchError(error)) throw error;
          if (batch.length <= 1) {
            // Single-file batch still fails with a splittable error —
            // drop the file, record it, and let the scan continue.
            droppedFiles.push(...batch);
            return [];
          }
          const splitIndex = Math.ceil(batch.length / 2);
          return [
            ...(await spawnLintBatch(batch.slice(0, splitIndex))),
            ...(await spawnLintBatch(batch.slice(splitIndex))),
          ];
        }
      };

      for (const batch of fileBatches) {
        allDiagnostics.push(...(await spawnLintBatch(batch)));
      }

      if (droppedFiles.length > 0 && onPartialFailure) {
        const previewCount = 3;
        const previewFiles = droppedFiles.slice(0, previewCount).join(", ");
        const remainderHint =
          droppedFiles.length > previewCount ? `, +${droppedFiles.length - previewCount} more` : "";
        onPartialFailure(
          `${droppedFiles.length} file(s) exceeded the ${OXLINT_SPAWN_TIMEOUT_MS / 1000}s per-batch oxlint budget and were skipped (${previewFiles}${remainderHint})`,
        );
      }
      return dedupeDiagnostics(allDiagnostics);
    };

    writeOxlintConfig(config);
    try {
      return await spawnLintBatches();
    } catch (error) {
      // HACK: if the user's adopted lint config is the reason oxlint
      // crashed (broken JSON, missing plugin, unknown rule), failing
      // the entire lint pass would leave the user with a 100/100
      // score off zero diagnostics — a worse outcome than running our
      // curated rules without their extras. Retry once without
      // `extends` and keep the scan useful. The retry is silent: a
      // mid-output stderr warning was noisy enough that users took it
      // as react-doctor itself crashing; the curated-rules scan is the
      // graceful path.
      if (extendsPaths.length === 0) throw error;
      const fallbackConfig = createOxlintConfig({
        pluginPath,
        project,
        customRulesOnly,
        extendsPaths: [],
        ignoredTags,
        serverAuthFunctionNames,
      });
      writeOxlintConfig(fallbackConfig);
      return await spawnLintBatches();
    }
  } finally {
    restoreDisableDirectives();
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
};
