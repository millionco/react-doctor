import { execSync } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import { SEPARATOR_LENGTH_CHARS } from "./constants.js";
import type { ScanOptions } from "./types.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { logger, startLoggerCapture, stopLoggerCapture } from "./utils/logger.js";
import { scan } from "./scan.js";
import { selectProjects } from "./utils/select-projects.js";
import { prompts } from "./utils/prompts.js";
import { maybePromptSkillInstall } from "./utils/skill-prompt.js";
import { maybeInstallGlobally } from "./utils/global-install.js";
import { copyToClipboard } from "./utils/copy-to-clipboard.js";

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
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

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

      if (!isScoreOnly) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const scanOptions: ScanOptions = {
        lint: flags.lint,
        deadCode: flags.deadCode,
        verbose: flags.prompt || Boolean(flags.verbose),
        scoreOnly: isScoreOnly,
      };

      const isAutomatedEnvironment = [
        process.env.CI,
        process.env.CLAUDECODE,
        process.env.CURSOR_TRACE_ID,
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
      );

      for (const projectDirectory of projectDirectories) {
        if (!isScoreOnly) {
          logger.dim(`Scanning ${projectDirectory}...`);
          logger.break();
        }
        await scan(projectDirectory, scanOptions);
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
  ${highlighter.info("https://github.com/aidenybai/react-doctor")}
`,
  );

const AMI_INSTALL_URL = "https://ami.dev/install.sh";
const FIX_PROMPT =
  "Fix all issues reported in the react-doctor diagnostics below, one by one. After applying fixes, run `react-dcotor` again to verify the results improved.";
const REACT_DOCTOR_OUTPUT_LABEL = "react-doctor output";
const SCAN_SUMMARY_SEPARATOR = "─".repeat(SEPARATOR_LENGTH_CHARS);

const isAmiInstalled = (): boolean => {
  try {
    execSync("ls /Applications/Ami.app", { stdio: "ignore" });
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

const openAmiToFix = (directory: string): void => {
  const resolvedDirectory = path.resolve(directory);

  if (!isAmiInstalled()) {
    installAmi();
  }

  logger.log("Opening Ami to fix react-doctor issues...");

  const encodedDirectory = encodeURIComponent(resolvedDirectory);
  const encodedPrompt = encodeURIComponent(FIX_PROMPT);
  const deeplink = `ami://open-project?cwd=${encodedDirectory}&prompt=${encodedPrompt}&mode=agent`;

  try {
    execSync(`open "${deeplink}"`, { stdio: "ignore" });
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
  return `${FIX_PROMPT}\n\n${REACT_DOCTOR_OUTPUT_LABEL}:\n\`\`\`\n${outputContent}\n\`\`\``;
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
  logger.break();
  logger.log(`Fix these issues with ${highlighter.info("Ami")}?`);
  logger.dim("   Ami is a coding agent built to understand your codebase and fix issues");
  logger.dim(`   automatically. Learn more at ${highlighter.info("https://ami.dev")}`);
  logger.break();

  const { shouldFix } = await prompts({
    type: "confirm",
    name: "shouldFix",
    message: "Open Ami to fix?",
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
