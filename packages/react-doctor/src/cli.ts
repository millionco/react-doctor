import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { SEPARATOR_LENGTH_CHARS } from "./constants.js";
import { scan } from "./scan.js";
import type { DiffInfo, ScanOptions } from "./types.js";
import { copyToClipboard } from "./utils/copy-to-clipboard.js";
import { filterSourceFiles, getDiffInfo } from "./utils/get-diff-files.js";
import { maybeInstallGlobally } from "./utils/global-install.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { loadConfig } from "./utils/load-config.js";
import { logger, startLoggerCapture, stopLoggerCapture } from "./utils/logger.js";
import { prompts } from "./utils/prompts.js";
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
  project?: string;
  packageJson?: string;
  diff?: boolean | string;
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

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
  .option("--package-json <directory>", "custom directory containing package.json")
  .option("--diff [base]", "scan only files changed vs base branch")
  .option("--fix", "open Ami to auto-fix all issues")
  .option("--prompt", "copy latest scan output to clipboard")
  .action(async (directory: string, flags: CliFlags) => {
    const isScoreOnly = flags.score && !flags.prompt;
    const shouldCopyPromptOutput = flags.prompt;

    if (shouldCopyPromptOutput) {
      startLoggerCapture();
    }

    try {
      const resolvedDirectory = path.resolve(directory);
      const userConfig = loadConfig(resolvedDirectory);

      if (!isScoreOnly) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const resolvedPackageJsonDirectory = flags.packageJson
        ? path.resolve(flags.packageJson)
        : undefined;

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
        packageJsonDirectory: resolvedPackageJsonDirectory,
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
      const projectDirectories = await selectProjects(
        resolvedDirectory,
        flags.project,
        shouldSkipPrompts,
        resolvedPackageJsonDirectory,
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
        await scan(projectDirectory, { ...scanOptions, includePaths });
        if (!isScoreOnly) {
          logger.break();
        }
      }

      if (flags.fix) {
        openAmiToFix(resolvedDirectory);
      }

      if (!isScoreOnly && !flags.prompt) {
        await maybePromptSkillInstall(shouldSkipPrompts);
        if (!shouldSkipPrompts && !flags.fix) {
          await maybePromptAmiFix(resolvedDirectory);
        }
      }
    } catch (error) {
      handleError(error, { shouldExit: !shouldCopyPromptOutput });
    } finally {
      if (shouldCopyPromptOutput) {
        const capturedOutput = stopLoggerCapture();
        copyPromptToClipboard(capturedOutput, !isScoreOnly);
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

const AMI_INSTALL_URL = "https://ami.dev/install.sh";
const AMI_RELEASES_URL = "https://github.com/millionco/ami-releases/releases";
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
  logger.log("Ami not found. Installing...");
  logger.break();
  try {
    execSync(`curl -fsSL ${AMI_INSTALL_URL} | bash`, { stdio: "inherit" });
  } catch {
    logger.error("Failed to install Ami. Visit https://ami.dev to install manually.");
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

const buildDeeplink = (directory: string): string => {
  const encodedDirectory = encodeURIComponent(path.resolve(directory));
  const encodedPrompt = encodeURIComponent(DEEPLINK_FIX_PROMPT);
  return `ami://open-project?cwd=${encodedDirectory}&prompt=${encodedPrompt}&mode=agent&autoSubmit=true`;
};

const openAmiToFix = (directory: string): void => {
  const isInstalled = isAmiInstalled();
  const deeplink = buildDeeplink(directory);

  if (!isInstalled) {
    if (process.platform === "darwin") {
      installAmi();
      logger.success("Ami was installed and opened.");
    } else {
      logger.error("Ami is not installed.");
      logger.dim(`Download it at ${highlighter.info(AMI_RELEASES_URL)}`);
    }
    logger.break();
    logger.dim("Once Ami is running, open this link to start fixing:");
    logger.info(deeplink);
    return;
  }

  logger.log("Opening Ami to fix react-doctor issues...");

  try {
    openUrl(deeplink);
    logger.success("Opened Ami with react-doctor fix prompt.");
  } catch {
    logger.break();
    logger.dim("Could not open Ami automatically. Open this URL manually:");
    logger.info(deeplink);
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

const maybePromptAmiFix = async (directory: string): Promise<void> => {
  const isInstalled = isAmiInstalled();

  logger.break();
  logger.log(`Fix these issues with ${highlighter.info("Ami")}?`);
  logger.dim("   Ami is a coding agent built to understand your codebase and fix issues");
  logger.dim(`   automatically. Learn more at ${highlighter.info("https://ami.dev")}`);
  logger.break();

  if (!isInstalled && process.platform !== "darwin") {
    logger.dim(`Download Ami at ${highlighter.info(AMI_RELEASES_URL)}`);
    return;
  }

  const promptMessage = isInstalled ? "Open Ami to fix?" : "Install Ami to fix?";
  const { shouldFix } = await prompts({
    type: "confirm",
    name: "shouldFix",
    message: promptMessage,
    initial: true,
  });

  if (shouldFix) {
    openAmiToFix(directory);
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
