import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { CANONICAL_GITHUB_URL } from "./constants.js";
import { runInstallSkill } from "./install-skill.js";
import { scan } from "./scan.js";
import type {
  Diagnostic,
  DiffInfo,
  FailOnLevel,
  JsonReport,
  JsonReportMode,
  ReactDoctorConfig,
  ScanOptions,
  ScanResult,
} from "./types.js";
import { buildJsonReport } from "./utils/build-json-report.js";
import { buildJsonReportError } from "./utils/build-json-report-error.js";
import { filterSourceFiles, getDiffInfo } from "./utils/get-diff-files.js";
import { getStagedSourceFiles, materializeStagedFiles } from "./utils/get-staged-files.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { loadConfig } from "./utils/load-config.js";
import { logger, setLoggerSilent } from "./utils/logger.js";
import { encodeAnnotationProperty, encodeAnnotationMessage } from "./utils/annotation-encoding.js";
import { prompts } from "./utils/prompts.js";
import { selectProjects } from "./utils/select-projects.js";

const VERSION = process.env.VERSION ?? "0.0.0";

interface CliFlags {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  score: boolean;
  json: boolean;
  jsonCompact: boolean;
  yes: boolean;
  full: boolean;
  offline: boolean;
  annotations: boolean;
  staged: boolean;
  respectInlineDisables: boolean;
  project?: string;
  diff?: boolean | string;
  failOn: string;
}

const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);

const isValidFailOnLevel = (level: string): level is FailOnLevel =>
  VALID_FAIL_ON_LEVELS.has(level as FailOnLevel);

const shouldFailForDiagnostics = (diagnostics: Diagnostic[], failOnLevel: FailOnLevel): boolean => {
  if (failOnLevel === "none") return false;
  if (failOnLevel === "warning") return diagnostics.length > 0;
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
};

const resolveFailOnLevel = (
  programInstance: Command,
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
): FailOnLevel => {
  const isCliOverride = programInstance.getOptionValueSource("failOn") === "cli";
  const sourceValue = isCliOverride ? flags.failOn : (userConfig?.failOn ?? flags.failOn);

  if (isValidFailOnLevel(sourceValue)) return sourceValue;
  logger.warn(
    `Invalid failOn level "${sourceValue}". Expected one of: error, warning, none. Falling back to "none".`,
  );
  return "none";
};

const printAnnotations = (diagnostics: Diagnostic[], routeToStderr: boolean): void => {
  const writeLine = routeToStderr
    ? (line: string) => process.stderr.write(`${line}\n`)
    : (line: string) => process.stdout.write(`${line}\n`);
  for (const diagnostic of diagnostics) {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const title = `${diagnostic.plugin}/${diagnostic.rule}`;
    const fileSegment = `file=${encodeAnnotationProperty(diagnostic.filePath)}`;
    const lineSegment = diagnostic.line > 0 ? `,line=${diagnostic.line}` : "";
    const titleSegment = `,title=${encodeAnnotationProperty(title)}`;
    const message = encodeAnnotationMessage(diagnostic.message);
    writeLine(`::${level} ${fileSegment}${lineSegment}${titleSegment}::${message}`);
  }
};

let isJsonModeActive = false;
let resolvedDirectoryForCancel: string | null = null;
let cancelStartTime = 0;
let currentReportMode: JsonReportMode = "full";

const exitGracefully = () => {
  if (isJsonModeActive) {
    writeJsonReport(
      buildJsonReportError({
        version: VERSION,
        directory: resolvedDirectoryForCancel ?? process.cwd(),
        error: new Error("Scan cancelled by user (SIGINT/SIGTERM)"),
        elapsedMilliseconds: performance.now() - cancelStartTime,
        mode: currentReportMode,
      }),
    );
    process.exit(130);
  }
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(130);
};

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

// HACK: env vars that mean "user is not at an interactive shell." We use this
// to skip prompts but NOT to auto-flip --offline, because dev shells often
// have JENKINS_URL / TF_BUILD set as ambient config without actually running
// in CI.
const NON_INTERACTIVE_ENVIRONMENT_VARIABLES = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "BUILDKITE",
  "JENKINS_URL",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
  "TEAMCITY_VERSION",
  "BITBUCKET_BUILD_NUMBER",
  "CIRCLECI",
  "TRAVIS",
  "DRONE",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
];

// HACK: only flip --offline by default for the narrowest set of CI signals
// where we're confident the run is automated and a share URL would be
// useless. Other tools that set non-interactive env vars (Jenkins agents,
// Azure DevOps tasks running interactively, agentic coding sessions) still
// get telemetry-on-by-default; users can pass --offline explicitly.
const CI_ENVIRONMENT_VARIABLES = ["GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"];

const isNonInteractiveEnvironment = (): boolean =>
  NON_INTERACTIVE_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable]));

const isCiEnvironment = (): boolean =>
  CI_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable])) ||
  process.env.CI === "true";

const resolveCliScanOptions = (
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
  programInstance: Command,
): ScanOptions => {
  const isCliOverride = (optionName: string) =>
    programInstance.getOptionValueSource(optionName) === "cli";

  return {
    lint: isCliOverride("lint") ? flags.lint : (userConfig?.lint ?? true),
    deadCode: isCliOverride("deadCode") ? flags.deadCode : (userConfig?.deadCode ?? true),
    verbose: isCliOverride("verbose") ? flags.verbose : (userConfig?.verbose ?? false),
    scoreOnly: flags.score,
    offline: flags.offline || isCiEnvironment(),
    silent: flags.json,
    respectInlineDisables: isCliOverride("respectInlineDisables")
      ? flags.respectInlineDisables
      : (userConfig?.respectInlineDisables ?? true),
  };
};

let isCompactJsonOutput = false;

const writeJsonReport = (report: JsonReport): void => {
  const serialized = isCompactJsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2);
  process.stdout.write(`${serialized}\n`);
};

// HACK: only the exact lowercase `"true"` / `"false"` literals are
// coerced to booleans — anything else stays as a (case-sensitive) branch
// name so that real branches like `True-Branch` / `FALSE-vN` aren't
// silently turned into a flag.
const coerceDiffValue = (value: unknown): boolean | string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length === 0) return undefined;
    if (value === "false") return false;
    if (value === "true") return true;
    return value;
  }
  // HACK: write directly to stderr so the warning is visible even in
  // `--json` mode (where the logger is silenced to keep stdout a
  // single valid JSON document).
  process.stderr.write(
    `[react-doctor] invalid diff value (expected boolean or string): ${typeof value}. Falling back to no diff.\n`,
  );
  return undefined;
};

const resolveEffectiveDiff = (
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
  programInstance: Command,
): boolean | string | undefined => {
  // HACK: --full is the documented "always run a full scan" escape hatch.
  // It must override config-set `diff: true` / `diff: "main"`, otherwise
  // the flag is silently ignored when a project's react-doctor.config.json
  // has any diff value.
  if (flags.full) return false;
  const isDiffCliOverride = programInstance.getOptionValueSource("diff") === "cli";
  const rawValue = isDiffCliOverride ? flags.diff : userConfig?.diff;
  return coerceDiffValue(rawValue);
};

const resolveDiffMode = async (
  diffInfo: DiffInfo | null,
  effectiveDiff: boolean | string | undefined,
  shouldSkipPrompts: boolean,
  isQuiet: boolean,
): Promise<boolean> => {
  if (effectiveDiff !== undefined && effectiveDiff !== false) {
    if (diffInfo) return true;
    if (!isQuiet) {
      logger.warn("No feature branch or uncommitted changes detected. Running full scan.");
      logger.break();
    }
    return false;
  }

  if (effectiveDiff === false || !diffInfo) return false;

  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  if (changedSourceFiles.length === 0) return false;
  if (shouldSkipPrompts) return false;
  if (isQuiet) return false;

  const promptMessage = diffInfo.isCurrentChanges
    ? `Found ${changedSourceFiles.length} uncommitted changed files. Only scan those?`
    : `On branch ${diffInfo.currentBranch} (${changedSourceFiles.length} files changed vs ${diffInfo.baseBranch}). Only scan changed files?`;

  const { shouldScanChangedOnly } = await prompts({
    type: "confirm",
    name: "shouldScanChangedOnly",
    message: promptMessage,
    initial: true,
  });
  return Boolean(shouldScanChangedOnly);
};

const validateModeFlags = (flags: CliFlags): void => {
  // HACK: use the same coercion as resolveEffectiveDiff so a bare
  // `--diff false` (or `--diff ""`) is treated as "no diff" and doesn't
  // trip the mutual-exclusion check against --staged.
  const coercedDiff = coerceDiffValue(flags.diff);
  const exclusiveModes = [
    flags.staged ? "--staged" : null,
    coercedDiff !== undefined && coercedDiff !== false ? "--diff" : null,
  ].filter((modeName): modeName is string => modeName !== null);

  if (exclusiveModes.length > 1) {
    throw new Error(`Cannot combine ${exclusiveModes.join(" and ")}; pick one mode.`);
  }
  if (flags.yes && flags.full) {
    throw new Error("Cannot combine --yes and --full; pick one.");
  }
  if (flags.score && flags.json) {
    throw new Error("Cannot combine --score and --json; pick one output mode.");
  }
  if (flags.annotations && (flags.json || flags.score)) {
    throw new Error("--annotations cannot be combined with --json or --score.");
  }
};

const program = new Command()
  .name("react-doctor")
  .description("Diagnose React codebase health")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to scan", ".")
  .option("--lint", "enable linting")
  .option("--no-lint", "skip linting")
  .option("--dead-code", "enable dead code detection")
  .option("--no-dead-code", "skip dead code detection")
  .option("--verbose", "show file details per rule")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("--json-compact", "with --json, emit compact JSON (no indentation)")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("--full", "force a full scan (overrides any `diff` value in config or `--diff`)")
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option(
    "--diff [base]",
    "scan only files changed vs base branch (pass `false` to disable; overridden by --full)",
  )
  .option("--offline", "skip telemetry (anonymous, not stored, only used to calculate score)")
  .option("--staged", "scan only staged (git index) files for pre-commit hooks")
  .option("--fail-on <level>", "exit with error code on diagnostics: error, warning, none", "error")
  .option("--annotations", "output diagnostics as GitHub Actions annotations")
  .option(
    "--respect-inline-disables",
    "respect inline `// eslint-disable*` / `// oxlint-disable*` comments (default)",
  )
  .option(
    "--no-respect-inline-disables",
    "audit mode: neutralize inline lint suppressions before scanning",
  )
  .action(async (directory: string, flags: CliFlags) => {
    const isScoreOnly = flags.score;
    const isJsonMode = flags.json;
    const isQuiet = isScoreOnly || isJsonMode;
    const resolvedDirectory = path.resolve(directory);
    const jsonStartTime = performance.now();

    isJsonModeActive = isJsonMode;
    isCompactJsonOutput = Boolean(flags.jsonCompact);
    resolvedDirectoryForCancel = resolvedDirectory;
    cancelStartTime = jsonStartTime;

    if (isJsonMode) {
      setLoggerSilent(true);
    }

    try {
      validateModeFlags(flags);

      const userConfig = loadConfig(resolvedDirectory);

      if (!isQuiet) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const scanOptions = resolveCliScanOptions(flags, userConfig, program);
      const shouldSkipPrompts =
        flags.yes ||
        flags.full ||
        isJsonMode ||
        isNonInteractiveEnvironment() ||
        !process.stdin.isTTY;

      if (!flags.offline && isCiEnvironment() && !isQuiet) {
        logger.dim("CI detected — scoring locally.");
        logger.break();
      }

      if (flags.staged) {
        currentReportMode = "staged";
        const stagedFiles = getStagedSourceFiles(resolvedDirectory);
        if (stagedFiles.length === 0) {
          if (isJsonMode) {
            writeJsonReport(
              buildJsonReport({
                version: VERSION,
                directory: resolvedDirectory,
                mode: "staged",
                diff: null,
                scans: [],
                totalElapsedMilliseconds: performance.now() - jsonStartTime,
              }),
            );
          } else if (!isScoreOnly) {
            logger.dim("No staged source files found.");
          }
          return;
        }

        if (!isQuiet) {
          logger.log(`Scanning ${highlighter.info(`${stagedFiles.length}`)} staged files...`);
          logger.break();
        }

        let tempDirectory: string | null = null;
        let cleanupSnapshot: (() => void) | null = null;
        try {
          tempDirectory = mkdtempSync(path.join(tmpdir(), "react-doctor-staged-"));
          const snapshot = materializeStagedFiles(resolvedDirectory, stagedFiles, tempDirectory);
          cleanupSnapshot = snapshot.cleanup;

          const scanResult = await scan(snapshot.tempDirectory, {
            ...scanOptions,
            includePaths: snapshot.stagedFiles,
            configOverride: userConfig,
          });

          const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            filePath: path.isAbsolute(diagnostic.filePath)
              ? diagnostic.filePath.replaceAll(snapshot.tempDirectory, resolvedDirectory)
              : diagnostic.filePath,
          }));

          if (isJsonMode) {
            const remappedScanResult: ScanResult = {
              ...scanResult,
              diagnostics: remappedDiagnostics,
              project: {
                ...scanResult.project,
                rootDirectory: resolvedDirectory,
              },
            };
            writeJsonReport(
              buildJsonReport({
                version: VERSION,
                directory: resolvedDirectory,
                mode: "staged",
                diff: null,
                scans: [{ directory: resolvedDirectory, result: remappedScanResult }],
                totalElapsedMilliseconds: performance.now() - jsonStartTime,
              }),
            );
          }

          if (flags.annotations) {
            printAnnotations(remappedDiagnostics, isJsonMode);
          }

          if (
            shouldFailForDiagnostics(
              remappedDiagnostics,
              resolveFailOnLevel(program, flags, userConfig),
            )
          ) {
            process.exitCode = 1;
          }
        } finally {
          cleanupSnapshot?.();
        }
        return;
      }

      const projectDirectories = await selectProjects(
        resolvedDirectory,
        flags.project,
        shouldSkipPrompts,
      );

      const effectiveDiff = resolveEffectiveDiff(flags, userConfig, program);
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
      const wantsDiffMode = effectiveDiff !== undefined && effectiveDiff !== false;
      // HACK: also call getDiffInfo when we MIGHT prompt the user — without
      // it, resolveDiffMode short-circuits at !diffInfo and the
      // "Only scan changed files?" prompt never appears for users on a
      // feature branch who didn't explicitly pass --diff.
      const shouldDetectDiff = wantsDiffMode || (!shouldSkipPrompts && !isQuiet);
      const diffInfo = shouldDetectDiff ? getDiffInfo(resolvedDirectory, explicitBaseBranch) : null;
      const isDiffMode = await resolveDiffMode(diffInfo, effectiveDiff, shouldSkipPrompts, isQuiet);

      // HACK: set the cancel-mode marker BEFORE the scan loop runs — if the
      // user hits Ctrl-C mid-scan, the SIGINT handler reads currentReportMode
      // for the JSON cancel report. Setting it after the loop completes
      // means a cancelled diff scan would report mode: "full".
      currentReportMode = isDiffMode ? "diff" : "full";

      if (isDiffMode && diffInfo && !isQuiet) {
        if (diffInfo.isCurrentChanges) {
          logger.log("Scanning uncommitted changes");
        } else {
          logger.log(
            `Scanning changes: ${highlighter.info(diffInfo.currentBranch)} → ${highlighter.info(diffInfo.baseBranch)}`,
          );
        }
        logger.break();
      }

      const allDiagnostics: Diagnostic[] = [];
      const completedScans: Array<{ directory: string; result: ScanResult }> = [];

      for (const projectDirectory of projectDirectories) {
        let includePaths: string[] | undefined;
        if (isDiffMode) {
          const projectDiffInfo =
            projectDirectory === resolvedDirectory
              ? diffInfo
              : getDiffInfo(projectDirectory, explicitBaseBranch);
          if (projectDiffInfo) {
            const changedSourceFiles = filterSourceFiles(projectDiffInfo.changedFiles);
            if (changedSourceFiles.length === 0) {
              if (!isQuiet) {
                logger.dim(`No changed source files in ${projectDirectory}, skipping.`);
                logger.break();
              }
              continue;
            }
            includePaths = changedSourceFiles;
          } else if (!isQuiet) {
            logger.dim(
              `Cannot detect diff for ${projectDirectory} (not a git repository?) — scanning all files.`,
            );
            logger.break();
          }
        }

        if (!isQuiet) {
          logger.dim(`Scanning ${projectDirectory}...`);
          logger.break();
        }
        const scanResult = await scan(projectDirectory, { ...scanOptions, includePaths });
        allDiagnostics.push(...scanResult.diagnostics);
        completedScans.push({ directory: projectDirectory, result: scanResult });
        if (!isQuiet) {
          logger.break();
        }
      }

      const reportMode: JsonReportMode = isDiffMode ? "diff" : "full";

      if (isJsonMode) {
        writeJsonReport(
          buildJsonReport({
            version: VERSION,
            directory: resolvedDirectory,
            mode: reportMode,
            diff: isDiffMode ? diffInfo : null,
            scans: completedScans,
            totalElapsedMilliseconds: performance.now() - jsonStartTime,
          }),
        );
      }

      if (flags.annotations) {
        printAnnotations(allDiagnostics, isJsonMode);
      }

      if (
        shouldFailForDiagnostics(allDiagnostics, resolveFailOnLevel(program, flags, userConfig))
      ) {
        process.exitCode = 1;
      }
    } catch (error) {
      try {
        if (isJsonMode) {
          writeJsonReport(
            buildJsonReportError({
              version: VERSION,
              directory: resolvedDirectory,
              error,
              elapsedMilliseconds: performance.now() - jsonStartTime,
              mode: currentReportMode,
            }),
          );
          process.exitCode = 1;
          return;
        }
        handleError(error);
      } catch {
        if (isJsonMode) {
          process.stdout.write(
            '{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error","chain":[]}}\n',
          );
        }
        process.exitCode = 1;
      }
    }
  })
  .addHelpText(
    "after",
    `
${highlighter.dim("Configuration:")}
  Place a ${highlighter.info("react-doctor.config.json")} (or ${highlighter.info('"reactDoctor"')} key in your package.json) in the project root.
  CLI flags always override config values. See the README for the full schema.

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`,
  );

program
  .command("install")
  .description("Install the react-doctor skill into your coding agents")
  .option("-y, --yes", "skip prompts, install for all detected agents")
  .option("--dry-run", "show what would be installed without writing files")
  .action(async (options: { yes?: boolean; dryRun?: boolean }) => {
    try {
      await runInstallSkill({ yes: options.yes, dryRun: options.dryRun });
    } catch (error) {
      handleError(error);
    }
  });

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
});

program.parseAsync().catch((error: unknown) => {
  if (isJsonModeActive) {
    try {
      writeJsonReport(
        buildJsonReportError({
          version: VERSION,
          directory: resolvedDirectoryForCancel ?? process.cwd(),
          error,
          elapsedMilliseconds: performance.now() - cancelStartTime,
          mode: currentReportMode,
        }),
      );
    } catch {
      process.stdout.write(
        '{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error","chain":[]}}\n',
      );
    }
    process.exit(1);
  }
  handleError(error);
});
