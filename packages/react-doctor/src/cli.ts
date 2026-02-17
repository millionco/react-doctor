import { execSync } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import type { ScanOptions } from "./types.js";
import { handleError } from "./utils/handle-error.js";
import { highlighter } from "./utils/highlighter.js";
import { logger } from "./utils/logger.js";
import { scan } from "./scan.js";
import { selectProjects } from "./utils/select-projects.js";
import { prompts } from "./utils/prompts.js";
import { maybePromptSkillInstall } from "./utils/skill-prompt.js";

const VERSION = process.env.VERSION ?? "0.0.0";

interface CliFlags {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  score: boolean;
  fix: boolean;
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
  .action(async (directory: string, flags: CliFlags) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      const isScoreOnly = flags.score;

      if (!isScoreOnly) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const scanOptions: ScanOptions = {
        lint: flags.lint,
        deadCode: flags.deadCode,
        verbose: Boolean(flags.verbose),
        scoreOnly: isScoreOnly,
      };

      const shouldSkipPrompts =
        flags.yes ||
        Boolean(process.env.CI) ||
        Boolean(process.env.CLAUDECODE) ||
        Boolean(process.env.CURSOR_TRACE_ID) ||
        Boolean(process.env.CURSOR_AGENT) ||
        Boolean(process.env.CODEX_CI) ||
        Boolean(process.env.OPENCODE) ||
        Boolean(process.env.AMP_HOME) ||
        Boolean(process.env.AMI) ||
        !process.stdin.isTTY;
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

      if (!isScoreOnly) {
        await maybePromptSkillInstall(shouldSkipPrompts);
        if (!shouldSkipPrompts && !flags.fix) {
          await maybePromptAmiFix(resolvedDirectory);
        }
      }
    } catch (error) {
      handleError(error);
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
const AMI_FIX_PROMPT =
  "Run npx -y react-doctor@latest . --verbose, read every diagnostic, then fix all issues one by one. After fixing, re-run react-doctor to verify the score improved.";

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
  const encodedPrompt = encodeURIComponent(AMI_FIX_PROMPT);
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
  .description("Open Ami to auto-fix react-doctor issues")
  .argument("[directory]", "project directory", ".")
  .action(fixAction);

program.addCommand(fixCommand);
program.addCommand(installAmiCommand);

const main = async () => {
  await program.parseAsync();
};

main();
