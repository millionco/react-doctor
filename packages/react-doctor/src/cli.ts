import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { scan } from "./scan.js";
import type { Diagnostic, DiffInfo, FailOnLevel, ReactDoctorConfig, ScanOptions } from "./types.js";
import { filterSourceFiles, getDiffInfo } from "./utils/get-diff-files.js";
import { getStagedSourceFiles, materializeStagedFiles } from "./utils/get-staged-files.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { loadConfig } from "./utils/load-config.js";
import { logger } from "./utils/logger.js";
import { prompts } from "./utils/prompts.js";
import { selectProjects } from "./utils/select-projects.js";

const VERSION = process.env.VERSION ?? "0.0.0";

interface CliFlags {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  score: boolean;
  yes: boolean;
  no: boolean;
  offline: boolean;
  annotations: boolean;
  staged: boolean;
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
  const resolvedFailOn =
    programInstance.getOptionValueSource("failOn") === "cli"
      ? flags.failOn
      : (userConfig?.failOn ?? flags.failOn);
  return isValidFailOnLevel(resolvedFailOn) ? resolvedFailOn : "none";
};

const printAnnotations = (diagnostics: Diagnostic[]): void => {
  for (const diagnostic of diagnostics) {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const title = `${diagnostic.plugin}/${diagnostic.rule}`;
    const fileLocation =
      diagnostic.line > 0
        ? `file=${diagnostic.filePath},line=${diagnostic.line}`
        : `file=${diagnostic.filePath}`;
    console.log(`::${level} ${fileLocation},title=${title}::${diagnostic.message}`);
  }
};

const exitGracefully = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(0);
};

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

const AUTOMATED_ENVIRONMENT_VARIABLES = [
  "CI",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
];

const isAutomatedEnvironment = (): boolean =>
  AUTOMATED_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable]));

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
    verbose: isCliOverride("verbose") ? Boolean(flags.verbose) : (userConfig?.verbose ?? false),
    scoreOnly: flags.score,
    offline: flags.offline,
  };
};

const resolveDiffMode = async (
  diffInfo: DiffInfo | null,
  effectiveDiff: boolean | string | undefined,
  shouldSkipPrompts: boolean,
  isScoreOnly: boolean,
): Promise<boolean> => {
  if (effectiveDiff !== undefined && effectiveDiff !== false) {
    if (diffInfo) return true;
    if (!isScoreOnly) {
      logger.warn("No feature branch or uncommitted changes detected. Running full scan.");
      logger.break();
    }
    return false;
  }

  if (effectiveDiff === false || !diffInfo) return false;

  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  if (changedSourceFiles.length === 0) return false;
  if (shouldSkipPrompts) return false;
  if (isScoreOnly) return false;

  const promptMessage = diffInfo.isCurrentChanges
    ? `Found ${changedSourceFiles.length} uncommitted changed files. Only scan current changes?`
    : `On branch ${diffInfo.currentBranch} (${changedSourceFiles.length} changed files vs ${diffInfo.baseBranch}). Only scan this branch?`;

  const { shouldScanChangedOnly } = await prompts({
    type: "confirm",
    name: "shouldScanChangedOnly",
    message: promptMessage,
    initial: true,
  });
  return Boolean(shouldScanChangedOnly);
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
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("-n, --no", "skip prompts, always run a full scan (decline diff-only)")
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option("--diff [base]", "scan only files changed vs base branch")
  .option("--offline", "skip telemetry (anonymous, not stored, only used to calculate score)")
  .option("--staged", "scan only staged (git index) files for pre-commit hooks")
  .option("--fail-on <level>", "exit with error code on diagnostics: error, warning, none", "none")
  .option("--annotations", "output diagnostics as GitHub Actions annotations")
  .action(async (directory: string, flags: CliFlags) => {
    const isScoreOnly = flags.score;

    try {
      const resolvedDirectory = path.resolve(directory);
      const userConfig = loadConfig(resolvedDirectory);

      if (!isScoreOnly) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const scanOptions = resolveCliScanOptions(flags, userConfig, program);
      const shouldSkipPrompts =
        flags.yes || flags.no || isAutomatedEnvironment() || !process.stdin.isTTY;

      if (flags.staged) {
        const stagedFiles = getStagedSourceFiles(resolvedDirectory);
        if (stagedFiles.length === 0) {
          if (!isScoreOnly) {
            logger.dim("No staged source files found.");
          }
          return;
        }

        if (!isScoreOnly) {
          logger.log(`Scanning ${highlighter.info(`${stagedFiles.length}`)} staged files...`);
          logger.break();
        }

        const tempDirectory = mkdtempSync(path.join(tmpdir(), "react-doctor-staged-"));
        const snapshot = materializeStagedFiles(resolvedDirectory, stagedFiles, tempDirectory);

        try {
          const scanResult = await scan(snapshot.tempDirectory, {
            ...scanOptions,
            includePaths: snapshot.stagedFiles,
          });

          const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            filePath: path.isAbsolute(diagnostic.filePath)
              ? diagnostic.filePath.replace(snapshot.tempDirectory, resolvedDirectory)
              : diagnostic.filePath,
          }));

          if (flags.annotations) {
            printAnnotations(remappedDiagnostics);
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
          snapshot.cleanup();
        }
        return;
      }

      const projectDirectories = await selectProjects(
        resolvedDirectory,
        flags.project,
        shouldSkipPrompts,
      );

      const isDiffCliOverride = program.getOptionValueSource("diff") === "cli";
      const effectiveDiff = isDiffCliOverride ? flags.diff : userConfig?.diff;
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
      const diffInfo = getDiffInfo(resolvedDirectory, explicitBaseBranch);
      const isDiffMode = await resolveDiffMode(
        diffInfo,
        effectiveDiff,
        shouldSkipPrompts,
        isScoreOnly,
      );

      if (isDiffMode && diffInfo && !isScoreOnly) {
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

      for (const projectDirectory of projectDirectories) {
        let includePaths: string[] | undefined;
        if (isDiffMode) {
          const projectDiffInfo = getDiffInfo(projectDirectory, explicitBaseBranch);
          if (projectDiffInfo) {
            const changedSourceFiles = filterSourceFiles(projectDiffInfo.changedFiles);
            if (changedSourceFiles.length === 0) {
              if (!isScoreOnly) {
                logger.dim(`No changed source files in ${projectDirectory}, skipping.`);
                logger.break();
              }
              continue;
            }
            includePaths = changedSourceFiles;
          }
        }

        if (!isScoreOnly) {
          logger.dim(`Scanning ${projectDirectory}...`);
          logger.break();
        }
        const scanResult = await scan(projectDirectory, { ...scanOptions, includePaths });
        allDiagnostics.push(...scanResult.diagnostics);
        if (!isScoreOnly) {
          logger.break();
        }
      }

      if (flags.annotations) {
        printAnnotations(allDiagnostics);
      }

      if (
        shouldFailForDiagnostics(allDiagnostics, resolveFailOnLevel(program, flags, userConfig))
      ) {
        process.exitCode = 1;
      }
    } catch (error) {
      handleError(error);
    }
  })
  .addHelpText(
    "after",
    `
${highlighter.dim("Learn more:")}
  ${highlighter.info("https://github.com/millionco/react-doctor")}
`,
  );

const main = async () => {
  await program.parseAsync();
};

main();
