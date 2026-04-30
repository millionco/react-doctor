import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectAvailableAgents,
  type SupportedAgent,
  toDisplayName,
} from "./utils/detect-agents.js";
import { highlighter } from "./utils/highlighter.js";
import { installSkillForAgent } from "./utils/install-skill-for-agent.js";
import { logger } from "./utils/logger.js";
import { prompts } from "./utils/prompts.js";
import { spinner } from "./utils/spinner.js";

const SKILL_NAME = "react-doctor";

interface InstallSkillOptions {
  yes?: boolean;
  dryRun?: boolean;
}

const getSkillSourceDirectory = (): string => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.join(distDirectory, "skills", SKILL_NAME);
};

export const runInstallSkill = async (options: InstallSkillOptions = {}): Promise<void> => {
  const projectRoot = process.cwd();
  const sourceDir = getSkillSourceDirectory();

  if (!existsSync(path.join(sourceDir, "SKILL.md"))) {
    logger.error(`Could not locate the ${SKILL_NAME} skill bundled with this package.`);
    process.exitCode = 1;
    return;
  }

  const detectedAgents = detectAvailableAgents();
  if (detectedAgents.length === 0) {
    logger.error("No supported coding agents detected on your PATH.");
    logger.dim(
      "  Supported: Claude Code, Codex, GitHub Copilot, Gemini CLI, Cursor, OpenCode, Factory Droid, Pi.",
    );
    process.exitCode = 1;
    return;
  }

  const skipPrompts = Boolean(options.yes) || !process.stdin.isTTY;

  const selectedAgents: SupportedAgent[] = skipPrompts
    ? detectedAgents
    : ((
        await prompts({
          type: "multiselect",
          name: "agents",
          message: `Install the ${highlighter.info(SKILL_NAME)} skill for:`,
          choices: detectedAgents.map((agent) => ({
            title: toDisplayName(agent),
            value: agent,
            selected: true,
          })),
          instructions: false,
          min: 1,
        })
      ).agents ?? []);

  if (selectedAgents.length === 0) return;

  if (options.dryRun) {
    logger.log(`Dry run — would install ${SKILL_NAME} skill for:`);
    for (const agent of selectedAgents) {
      logger.dim(`  - ${toDisplayName(agent)}`);
    }
    logger.dim(`  Source: ${sourceDir}`);
    return;
  }

  const installSpinner = spinner(`Installing ${SKILL_NAME} skill...`).start();
  const installedDirectories = new Set<string>();
  for (const agent of selectedAgents) {
    const installedDirectory = installSkillForAgent(
      projectRoot,
      agent,
      sourceDir,
      SKILL_NAME,
      installedDirectories,
    );
    installedDirectories.add(installedDirectory);
  }
  installSpinner.succeed(
    `${SKILL_NAME} skill installed for ${selectedAgents.map(toDisplayName).join(", ")}.`,
  );
};
