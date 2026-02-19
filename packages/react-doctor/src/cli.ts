import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  OPEN_BASE_URL,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  SEPARATOR_LENGTH_CHARS,
} from "./constants.js";
import { scan } from "./scan.js";
import type { Diagnostic, DiffInfo, EstimatedScoreResult, ScanOptions } from "./types.js";
import { fetchEstimatedScore } from "./utils/calculate-score.js";
import { copyToClipboard } from "./utils/copy-to-clipboard.js";
import { createFramedLine, renderFramedBoxString } from "./utils/framed-box.js";
import { filterSourceFiles, getDiffInfo } from "./utils/get-diff-files.js";
import { maybeInstallGlobally } from "./utils/global-install.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { loadConfig } from "./utils/load-config.js";
import { logger, startLoggerCapture, stopLoggerCapture } from "./utils/logger.js";
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
  prompt: boolean;
  yes: boolean;
  offline: boolean;
  ami: boolean;
  project?: string;
  diff?: boolean | string;
}

const exitWithFixHint = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.dim("Run `npx react-doctor@latest --fix` to fix issues.");
  logger.break();
  process.exit(0);
};

process.on("SIGINT", exitWithFixHint);
process.on("SIGTERM", exitWithFixHint);

const resolveDiffMode = async (
  diffInfo: DiffInfo | null,
  effectiveDiff: boolean | string | undefined,
  shouldSkipPrompts: boolean,
  isScoreOnly: boolean,
): Promise<boolean> => {
  if (effectiveDiff !== undefined && effectiveDiff !== false) {
    if (diffInfo) return true;
    if (!isScoreOnly) {
      logger.warn("Not on a feature branch or could not determine base branch. Running full scan.");
      logger.break();
    }
    return false;
  }

  if (effectiveDiff === false || !diffInfo) return false;

  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  if (changedSourceFiles.length === 0) return false;
  if (shouldSkipPrompts) return true;
  if (isScoreOnly) return false;

  const { shouldScanBranchOnly } = await prompts({
    type: "confirm",
    name: "shouldScanBranchOnly",
    message: `On branch ${diffInfo.currentBranch} (${changedSourceFiles.length} changed files vs ${diffInfo.baseBranch}). Only scan this branch?`,
    initial: true,
  });
  return Boolean(shouldScanBranchOnly);
};

const program = new Command()
  .name("react-doctor")
  .description("Diagnose React codebase health")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to scan", ".")
  .option("--no-lint", "skip linting")
  .option("--no-dead-code", "skip dead code detection")
  .option("--verbose", "show file details per rule")
  .option("--score", "output only the score")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option("--diff [base]", "scan only files changed vs base branch")
  .option("--offline", "skip telemetry (anonymous, not stored, only used to calculate score)")
  .option("--no-ami", "skip Ami-related prompts")
  .option("--fix", "open Ami to auto-fix all issues")
  .option("--prompt", "copy latest scan output to clipboard")
  .action(async (directory: string, flags: CliFlags) => {
    const isScoreOnly = flags.score && !flags.prompt;
    const shouldCopyPromptOutput = flags.prompt;

    startLoggerCapture();

    try {
      const resolvedDirectory = path.resolve(directory);
      const userConfig = loadConfig(resolvedDirectory);

      if (!isScoreOnly) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const isCliOverride = (optionName: string) =>
        program.getOptionValueSource(optionName) === "cli";

      const scanOptions: ScanOptions = {
        lint: isCliOverride("lint") ? flags.lint : (userConfig?.lint ?? flags.lint),
        deadCode: isCliOverride("deadCode")
          ? flags.deadCode
          : (userConfig?.deadCode ?? flags.deadCode),
        verbose:
          flags.prompt ||
          (isCliOverride("verbose") ? Boolean(flags.verbose) : (userConfig?.verbose ?? false)),
        scoreOnly: isScoreOnly,
        offline: flags.offline,
      };

      const isAutomatedEnvironment = [
        process.env.CI,
        process.env.CLAUDECODE,
        process.env.CURSOR_AGENT,
        process.env.CODEX_CI,
        process.env.OPENCODE,
        process.env.AMP_HOME,
        process.env.AMI,
      ].some(Boolean);
      const shouldSkipPrompts = flags.yes || isAutomatedEnvironment || !process.stdin.isTTY;
      const shouldSkipAmiPrompts = shouldSkipPrompts || !flags.ami;
      const projectDirectories = await selectProjects(
        resolvedDirectory,
        flags.project,
        shouldSkipPrompts,
      );

      const effectiveDiff = isCliOverride("diff") ? flags.diff : userConfig?.diff;
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
      const diffInfo = getDiffInfo(resolvedDirectory, explicitBaseBranch);
      const isDiffMode = await resolveDiffMode(
        diffInfo,
        effectiveDiff,
        shouldSkipPrompts,
        isScoreOnly,
      );

      if (isDiffMode && diffInfo && !isScoreOnly) {
        logger.log(
          `Scanning changes: ${highlighter.info(diffInfo.currentBranch)} → ${highlighter.info(diffInfo.baseBranch)}`,
        );
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

      const capturedScanOutput = stopLoggerCapture();

      if (flags.fix) {
        openAmiToFix(resolvedDirectory);
      }

      if (shouldCopyPromptOutput) {
        copyPromptToClipboard(capturedScanOutput, !isScoreOnly);
      } else if (!isScoreOnly) {
        await maybePromptSkillInstall(shouldSkipAmiPrompts);
        if (!shouldSkipAmiPrompts && !flags.fix) {
          const estimatedScoreResult = flags.offline
            ? null
            : await fetchEstimatedScore(allDiagnostics);
          await maybePromptFix(
            resolvedDirectory,
            allDiagnostics,
            estimatedScoreResult,
            capturedScanOutput,
          );
        }
      }
    } catch (error) {
      handleError(error, { shouldExit: !shouldCopyPromptOutput });
    } finally {
      const remainingOutput = stopLoggerCapture();
      if (shouldCopyPromptOutput && remainingOutput) {
        copyPromptToClipboard(remainingOutput, !isScoreOnly);
      }
    }
  })
  .addHelpText(
    "after",
    `
${highlighter.dim("Learn more:")}
  ${highlighter.info("https://github.com/millionco/react-doctor")}
`,
  );

const AMI_WEBSITE_URL = "https://ami.dev";
const AMI_INSTALL_URL = `${AMI_WEBSITE_URL}/install.sh`;
const AMI_RELEASES_URL = "https://github.com/millionco/ami-releases/releases";

const colorizeByScore = (text: string, score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return highlighter.success(text);
  if (score >= SCORE_OK_THRESHOLD) return highlighter.warn(text);
  return highlighter.error(text);
};

const DEEPLINK_FIX_PROMPT =
  "Run `npx -y react-doctor@latest .` to diagnose issues, then fix all reported issues one by one. After applying fixes, run it again to verify the results improved.";
const CLIPBOARD_FIX_PROMPT =
  "Fix all issues reported in the react-doctor diagnostics below, one by one. After applying fixes, run `npx -y react-doctor@latest .` again to verify the results improved.";
const REACT_DOCTOR_OUTPUT_LABEL = "react-doctor output";
const SCAN_SUMMARY_SEPARATOR = "─".repeat(SEPARATOR_LENGTH_CHARS);

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
      logger.success("Ami installed successfully.");
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

const buildPromptWithOutput = (reactDoctorOutput: string): string => {
  const summaryStartIndex = reactDoctorOutput.indexOf(SCAN_SUMMARY_SEPARATOR);
  const diagnosticsOutput =
    summaryStartIndex === -1
      ? reactDoctorOutput
      : reactDoctorOutput.slice(0, summaryStartIndex).trimEnd();
  const normalizedReactDoctorOutput = diagnosticsOutput.trim();
  const outputContent =
    normalizedReactDoctorOutput.length > 0 ? normalizedReactDoctorOutput : "No output captured.";
  return `${CLIPBOARD_FIX_PROMPT}\n\n${REACT_DOCTOR_OUTPUT_LABEL}:\n\`\`\`\n${outputContent}\n\`\`\``;
};

const copyPromptToClipboard = (reactDoctorOutput: string, shouldLogResult: boolean): void => {
  const promptWithOutput = buildPromptWithOutput(reactDoctorOutput);
  const didCopyPromptToClipboard = copyToClipboard(promptWithOutput);

  if (!shouldLogResult) {
    return;
  }

  if (didCopyPromptToClipboard) {
    logger.success("Copied latest scan output to clipboard");
    return;
  }

  logger.warn("Could not copy prompt to clipboard automatically. Use this prompt:");
  logger.info(promptWithOutput);
};

const FIX_METHOD_AMI = "ami";
const FIX_METHOD_CLIPBOARD = "clipboard";
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

const buildClipboardWarningBanner = (): string =>
  renderFramedBoxString([
    createFramedLine(
      "⚠ Other agents may not fix these issues well.",
      `${highlighter.warn("⚠")} Other agents may not fix these issues well.`,
    ),
    createFramedLine(""),
    createFramedLine("react-doctor diagnostics require React-specific context"),
    createFramedLine("that general-purpose agents often miss, leading to"),
    createFramedLine("incomplete or incorrect fixes."),
  ]);

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
  setSelectBanner(buildClipboardWarningBanner(), 1);
  setSelectBanner(buildSkipBanner(issueCount, estimatedScore), 2);
};

const maybePromptFix = async (
  directory: string,
  diagnostics: Diagnostic[],
  estimatedScoreResult: EstimatedScoreResult | null,
  capturedScanOutput: string,
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
        title: "Use ami.dev (recommended)",
        description: "Optimized coding agent for React Doctor",
        value: FIX_METHOD_AMI,
      },
      {
        title: "Copy to clipboard",
        description: "Other agents may lack context for react-doctor fixes",
        value: FIX_METHOD_CLIPBOARD,
      },
      { title: "Skip", value: "skip" },
    ],
  });

  clearSelectBanner();

  if (fixMethod === FIX_METHOD_AMI) {
    openAmiToFix(directory);
  } else if (fixMethod === FIX_METHOD_CLIPBOARD) {
    copyPromptToClipboard(capturedScanOutput, true);
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
  maybeInstallGlobally();
  await program.parseAsync();
};

main();
