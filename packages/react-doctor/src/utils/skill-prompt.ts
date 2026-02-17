import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { highlighter } from "./highlighter.js";
import { logger } from "./logger.js";
import { prompts } from "./prompts.js";

const CONFIG_DIRECTORY = join(homedir(), ".react-doctor");
const CONFIG_FILE = join(CONFIG_DIRECTORY, "config.json");
const SKILL_REPO = "millionco/react-doctor";

interface UserConfig {
  skillPromptDismissed?: boolean;
}

const readConfig = (): UserConfig => {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
};

const writeConfig = (config: UserConfig): void => {
  try {
    if (!existsSync(CONFIG_DIRECTORY)) {
      mkdirSync(CONFIG_DIRECTORY, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {}
};

const installSkill = (): void => {
  try {
    execSync(`npx -y skills add ${SKILL_REPO}`, { stdio: "inherit" });
  } catch {
    logger.break();
    logger.dim("Skill install failed. You can install manually:");
    logger.dim(`  npx skills add ${SKILL_REPO}`);
  }
};

export const maybePromptSkillInstall = async (shouldSkipPrompts: boolean): Promise<void> => {
  const config = readConfig();
  if (config.skillPromptDismissed) return;
  if (shouldSkipPrompts) return;

  logger.break();
  logger.log(`${highlighter.info("💡")} Have your coding agent fix these issues automatically?`);
  logger.dim(
    `   Install the ${highlighter.info("react-doctor")} skill to teach Cursor, Claude Code, Copilot,`,
  );
  logger.dim("   Ami, and other AI agents how to diagnose and fix these React issues.");
  logger.break();

  const { shouldInstall } = await prompts({
    type: "confirm",
    name: "shouldInstall",
    message: "Install skill?",
    initial: true,
  });

  if (shouldInstall) {
    logger.break();
    installSkill();
    writeConfig({ ...config, skillPromptDismissed: true });
  }
};
