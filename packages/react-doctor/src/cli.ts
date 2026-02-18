import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { SEPARATOR_LENGTH_CHARS } from "./constants.js";
import type { Framework, ScanOptions } from "./types.js";
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
  framework?: string;
}

const SUPPORTED_FRAMEWORKS: Framework[] = [
  "nextjs",
  "vite",
  "cra",
  "remix",
  "gatsby",
  "roblox-ts",
  "unknown",
];

const parseFrameworkOverride = (frameworkName?: string): Framework | undefined => {
  if (!frameworkName) {
    return undefined;
  }

  const normalizedFramework = frameworkName.toLowerCase();
  if (normalizedFramework === "nextjs") return "nextjs";
  if (normalizedFramework === "vite") return "vite";
  if (normalizedFramework === "cra") return "cra";
  if (normalizedFramework === "remix") return "remix";
  if (normalizedFramework === "gatsby") return "gatsby";
  if (normalizedFramework === "roblox-ts") return "roblox-ts";
  if (normalizedFramework === "unknown") return "unknown";

  throw new Error(
    `Invalid framework override "${frameworkName}". Supported values: ${SUPPORTED_FRAMEWORKS.join(", ")}`,
  );
};

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
  .option("--framework <name>", "override framework detection")
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
        frameworkOverride: parseFrameworkOverride(flags.framework),
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
