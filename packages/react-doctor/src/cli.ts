import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { AMI_INSTALL_URL, AMI_RELEASES_URL, AMI_WEBSITE_URL, OPEN_BASE_URL } from "./constants.js";
import { scan } from "./scan.js";
import type {
  Diagnostic,
  DiffInfo,
  EstimatedScoreResult,
  FailOnLevel,
  ReactDoctorConfig,
  ScanOptions,
} from "./types.js";
import { fetchEstimatedScore } from "./utils/calculate-score.js";
import { colorizeByScore } from "./utils/colorize-by-score.js";
import { createFramedLine, renderFramedBoxString } from "./utils/framed-box.js";
import { filterSourceFiles, getDiffInfo } from "./utils/get-diff-files.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { loadConfig } from "./utils/load-config.js";
import { logger } from "./utils/logger.js";
import { clearSelectBanner, prompts, setSelectBanner } from "./utils/prompts.js";
import { selectProjects } from "./utils/select-projects.js";
import { maybePromptSkillInstall } from "./utils/skill-prompt.js";

const VERSION = process.env.VERSION ?? "0.0.0";

interface CliFlags {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  score: boolean;
  fix: boolean;
  yes: boolean;
  offline: boolean;
  ami: boolean;
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

const exitWithFixHint = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.dim("Run `npx react-doctor@latest --fix` to fix issues.");
  logger.break();
  process.exit(0);
};

process.on("SIGINT", exitWithFixHint);
process.on("SIGTERM", exitWithFixHint);

const AUTOMATED_ENVIRONMENT_VARIABLES = [
  "CI",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
  "AMI",
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
  if (shouldSkipPrompts) return true;
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
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option("--diff [base]", "scan only files changed vs base branch")
  .option("--offline", "skip telemetry (anonymous, not stored, only used to calculate score)")
  .option("--no-ami", "skip Ami-related prompts")
  .option("--fail-on <level>", "exit with error code on diagnostics: error, warning, none", "none")
  .option("--fix", "open Ami to auto-fix all issues")
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
      const shouldSkipPrompts = flags.yes || isAutomatedEnvironment() || !process.stdin.isTTY;
      const shouldSkipAmiPrompts = shouldSkipPrompts || !flags.ami;
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

      const resolvedFailOn =
        program.getOptionValueSource("failOn") === "cli"
          ? flags.failOn
          : (userConfig?.failOn ?? flags.failOn);
      const effectiveFailOn: FailOnLevel = isValidFailOnLevel(resolvedFailOn)
        ? resolvedFailOn
        : "none";

      if (shouldFailForDiagnostics(allDiagnostics, effectiveFailOn)) {
        process.exitCode = 1;
      }

      if (flags.fix) {
        openAmiToFix(resolvedDirectory);
      }

      if (!isScoreOnly && !shouldSkipAmiPrompts && !flags.fix) {
        await maybePromptSkillInstall(shouldSkipAmiPrompts);
        const estimatedScoreResult = flags.offline
          ? null
          : await fetchEstimatedScore(allDiagnostics);
        await maybePromptFix(resolvedDirectory, allDiagnostics, estimatedScoreResult);
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

const DEEPLINK_FIX_PROMPT = "/{slash-command:ami:react-doctor}";

const isAmiInstalled = (): boolean => {
  if (process.platform === "darwin") {
    return (
      existsSync("/Applications/Ami.app") ||
      existsSync(path.join(os.homedir(), "Applications", "Ami.app"))
    );
  }

  if (process.platform === "win32") {
    const { LOCALAPPDATA, PROGRAMFILES } = process.env;
    return (
      Boolean(LOCALAPPDATA && existsSync(path.join(LOCALAPPDATA, "Programs", "Ami", "Ami.exe"))) ||
      Boolean(PROGRAMFILES && existsSync(path.join(PROGRAMFILES, "Ami", "Ami.exe")))
    );
  }

  try {
    execSync("which ami", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const installAmi = (): void => {
  logger.log("Installing Ami...");
  logger.break();
  try {
    execSync(`curl -fsSL ${AMI_INSTALL_URL} | bash`, { stdio: "inherit" });
  } catch {
    logger.error(`Failed to install Ami. Visit ${AMI_WEBSITE_URL} to install manually.`);
    process.exit(1);
  }
  logger.break();
};

const openUrl = (url: string): void => {
  if (process.platform === "win32") {
    // HACK: cmd.exe interprets %XX% as env var expansion, which mangles encoded URLs.
    // Escaping % as %% produces literal % in cmd output.
    const cmdEscapedUrl = url.replace(/%/g, "%%");
    execSync(`start "" "${cmdEscapedUrl}"`, { stdio: "ignore" });
    return;
  }
  const openCommand = process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  execSync(openCommand, { stdio: "ignore" });
};

const buildDeeplinkParams = (directory: string): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("cwd", path.resolve(directory));
  params.set("prompt", DEEPLINK_FIX_PROMPT);
  params.set("mode", "agent");
  params.set("autoSubmit", "true");
  params.set("source", "react-doctor");
  return params;
};

const buildDeeplink = (directory: string): string =>
  `ami://open-project?${buildDeeplinkParams(directory).toString()}`;

const buildWebDeeplink = (directory: string): string =>
  `${OPEN_BASE_URL}?${buildDeeplinkParams(directory).toString()}`;

const openAmiToFix = (directory: string): void => {
  const isInstalled = isAmiInstalled();
  const deeplink = buildDeeplink(directory);
  const webDeeplink = buildWebDeeplink(directory);

  if (!isInstalled) {
    if (process.platform === "darwin") {
      installAmi();
      if (isAmiInstalled()) {
        logger.success("Ami installed successfully.");
      } else {
        logger.error("Installation could not be verified.");
        logger.dim(`Install manually at ${highlighter.info(AMI_WEBSITE_URL)}`);
      }
    } else {
      logger.error("Ami is not installed.");
      logger.dim(`Download at ${highlighter.info(AMI_RELEASES_URL)}`);
    }
    logger.break();
    logger.dim("Open this link to start fixing:");
    logger.info(webDeeplink);
    return;
  }

  logger.log("Opening Ami...");

  try {
    openUrl(deeplink);
    logger.success("Ami opened. Fixing your issues now.");
  } catch {
    logger.break();
    logger.dim("Could not open Ami automatically. Open this link instead:");
    logger.info(webDeeplink);
  }
};

const FIX_METHOD_AMI = "ami";
const FIX_COMMAND_HINT = "npx react-doctor@latest --fix";

const buildAmiBanner = (
  issueCount: number,
  currentScore: number,
  estimatedScore: number,
): string => {
  const currentScoreDisplay = colorizeByScore(String(currentScore), currentScore);
  const estimatedScoreDisplay = colorizeByScore(`~${estimatedScore}`, estimatedScore);
  const issueLabel = issueCount === 1 ? "issue" : "issues";

  return renderFramedBoxString([
    createFramedLine(
      `Score: ${currentScore} → ~${estimatedScore}`,
      `Score: ${currentScoreDisplay} ${highlighter.dim("→")} ${estimatedScoreDisplay}`,
    ),
    createFramedLine(""),
    createFramedLine(
      `Ami is a coding agent built for React. It reads`,
      `${highlighter.info("Ami")} is a coding agent built for React. It reads`,
    ),
    createFramedLine("your react-doctor report, understands your codebase,"),
    createFramedLine(
      `and fixes ${issueCount} ${issueLabel} one by one — then re-runs the`,
      `and fixes ${highlighter.warn(String(issueCount))} ${issueLabel} one by one — then re-runs the`,
    ),
    createFramedLine("scan to verify the score improved."),
    createFramedLine(""),
    createFramedLine(
      `Free to use. ${AMI_WEBSITE_URL}`,
      `Free to use. ${highlighter.info(AMI_WEBSITE_URL)}`,
    ),
  ]);
};

const buildSkipBanner = (issueCount: number, estimatedScore: number): string => {
  const issueLabel = issueCount === 1 ? "issue" : "issues";
  const estimatedScoreDisplay = colorizeByScore(`~${estimatedScore}`, estimatedScore);

  return renderFramedBoxString([
    createFramedLine(
      `Skip fixing ${issueCount} ${issueLabel} and reaching ~${estimatedScore}?`,
      `Skip fixing ${highlighter.warn(String(issueCount))} ${issueLabel} and reaching ${estimatedScoreDisplay}?`,
    ),
    createFramedLine(""),
    createFramedLine(
      `Run ${FIX_COMMAND_HINT} anytime to come back.`,
      `Run ${highlighter.info(FIX_COMMAND_HINT)} anytime to come back.`,
    ),
  ]);
};

const configureFixBanners = (
  issueCount: number,
  estimatedScoreResult: EstimatedScoreResult,
): void => {
  const { currentScore, estimatedScore } = estimatedScoreResult;
  setSelectBanner(buildAmiBanner(issueCount, currentScore, estimatedScore), 0);
  setSelectBanner(buildSkipBanner(issueCount, estimatedScore), 1);
};

const maybePromptFix = async (
  directory: string,
  diagnostics: Diagnostic[],
  estimatedScoreResult: EstimatedScoreResult | null,
): Promise<void> => {
  if (diagnostics.length === 0) return;

  logger.break();

  if (estimatedScoreResult) {
    configureFixBanners(diagnostics.length, estimatedScoreResult);
  }

  const { fixMethod } = await prompts({
    type: "select",
    name: "fixMethod",
    message: "Fix issues?",
    choices: [
      {
        title: "Use Ami (recommended)",
        description: "Optimized coding agent for React Doctor",
        value: FIX_METHOD_AMI,
      },
      { title: "Skip", value: "skip" },
    ],
  });

  clearSelectBanner();

  if (fixMethod === FIX_METHOD_AMI) {
    openAmiToFix(directory);
  } else {
    logger.break();
    logger.dim(`  Run ${highlighter.info(FIX_COMMAND_HINT)} anytime to fix issues.`);
  }
};

const fixAction = (directory: string) => {
  try {
    openAmiToFix(directory);
  } catch (error) {
    handleError(error);
  }
};

const fixCommand = new Command("fix")
  .description("Open Ami to auto-fix react-doctor issues")
  .argument("[directory]", "project directory", ".")
  .action(fixAction);

const installAmiCommand = new Command("install-ami")
  .description("Install Ami and open it to auto-fix issues")
  .argument("[directory]", "project directory", ".")
  .action(fixAction);

program.addCommand(fixCommand);
program.addCommand(installAmiCommand);

const main = async () => {
  await program.parseAsync();
};

main();
