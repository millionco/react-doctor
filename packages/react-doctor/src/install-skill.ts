import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installSkillsFromSource, SKILL_MANIFEST_FILE, type SkillAgentType } from "agent-install";
import { SKILL_NAME } from "./constants.js";
import { detectAvailableAgents } from "./utils/detect-agents.js";
import { highlighter } from "./utils/highlighter.js";
import { logger } from "./utils/logger.js";
import { prompts } from "./utils/prompts.js";
import { spinner } from "./utils/spinner.js";
import { toDisplayName } from "./utils/to-display-name.js";

interface InstallSkillOptions {
  yes?: boolean;
  dryRun?: boolean;
  // Overrides for tests; production callers leave these unset.
  sourceDir?: string;
  projectRoot?: string;
  detectedAgents?: SkillAgentType[];
}

const getSkillSourceDirectory = (): string => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.join(distDirectory, "skills", SKILL_NAME);
};

export const runInstallSkill = async (options: InstallSkillOptions = {}): Promise<void> => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const sourceDir = options.sourceDir ?? getSkillSourceDirectory();

  if (!existsSync(path.join(sourceDir, SKILL_MANIFEST_FILE))) {
    logger.error(`Could not locate the ${SKILL_NAME} skill bundled with this package.`);
    process.exitCode = 1;
    return;
  }

  const detectedAgents = options.detectedAgents ?? (await detectAvailableAgents());
  if (detectedAgents.length === 0) {
    logger.error("No supported coding agents detected.");
    logger.dim(
      "  Looked for binaries on PATH (claude, codex, cursor, droid, gemini, copilot, opencode, pi)",
    );
    logger.dim("  and config dirs in $HOME (~/.claude, ~/.cursor, ~/.codex, ~/.gemini, ...).");
    process.exitCode = 1;
    return;
  }

  const skipPrompts = Boolean(options.yes) || !process.stdin.isTTY;

  const selectedAgents: SkillAgentType[] = skipPrompts
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
  try {
    const installResult = await installSkillsFromSource({
      source: sourceDir,
      agents: selectedAgents,
      cwd: projectRoot,
      mode: "copy",
    });

    if (installResult.skills.length === 0) {
      throw new Error(
        `Could not parse ${SKILL_MANIFEST_FILE} for ${SKILL_NAME} (missing or invalid frontmatter).`,
      );
    }
    if (installResult.failed.length > 0) {
      throw new Error(
        installResult.failed
          .map((failure) => `${toDisplayName(failure.agent)}: ${failure.error}`)
          .join("\n"),
      );
    }

    installSpinner.succeed(
      `${SKILL_NAME} skill installed for ${selectedAgents.map(toDisplayName).join(", ")}.`,
    );
  } catch (error) {
    installSpinner.fail(`Failed to install ${SKILL_NAME} skill.`);
    throw error;
  }
};
