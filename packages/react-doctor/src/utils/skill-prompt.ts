import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { highlighter } from "./highlighter.js";
import { logger } from "./logger.js";
import { prompts } from "./prompts.js";

const HOME_DIRECTORY = homedir();
const CONFIG_DIRECTORY = join(HOME_DIRECTORY, ".react-doctor");
const CONFIG_FILE = join(CONFIG_DIRECTORY, "config.json");

const SKILL_NAME = "react-doctor";
const WINDSURF_MARKER = "# React Doctor";

const SKILL_DESCRIPTION =
  "Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project.";

const SKILL_BODY = `Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## Usage

\`\`\`bash
npx -y react-doctor@latest . --verbose --diff
\`\`\`

## Workflow

Run after making changes to catch issues early. Fix errors first, then re-run to verify the score improved.`;

const SKILL_CONTENT = `---
name: ${SKILL_NAME}
description: ${SKILL_DESCRIPTION}
version: 1.0.0
---

# React Doctor

${SKILL_BODY}
`;

const AGENTS_CONTENT = `# React Doctor

${SKILL_DESCRIPTION}

${SKILL_BODY}
`;

const CODEX_AGENT_CONFIG = `interface:
  display_name: "${SKILL_NAME}"
  short_description: "Diagnose and fix React codebase health issues"
`;

interface SkillPromptConfig {
  skillPromptDismissed?: boolean;
}

interface SkillTarget {
  name: string;
  detect: () => boolean;
  install: () => void;
}

const readSkillPromptConfig = (): SkillPromptConfig => {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
};

const writeSkillPromptConfig = (config: SkillPromptConfig): void => {
  try {
    mkdirSync(CONFIG_DIRECTORY, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {}
};

const writeSkillFiles = (directory: string): void => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), SKILL_CONTENT);
  writeFileSync(join(directory, "AGENTS.md"), AGENTS_CONTENT);
};

const isCommandAvailable = (command: string): boolean => {
  try {
    const whichCommand = process.platform === "win32" ? "where" : "which";
    execSync(`${whichCommand} ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const SKILL_TARGETS: SkillTarget[] = [
  {
    name: "Claude Code",
    detect: () => existsSync(join(HOME_DIRECTORY, ".claude")),
    install: () => writeSkillFiles(join(HOME_DIRECTORY, ".claude", "skills", SKILL_NAME)),
  },
  {
    name: "Amp Code",
    detect: () => existsSync(join(HOME_DIRECTORY, ".amp")),
    install: () => writeSkillFiles(join(HOME_DIRECTORY, ".config", "amp", "skills", SKILL_NAME)),
  },
  {
    name: "Cursor",
    detect: () => existsSync(join(HOME_DIRECTORY, ".cursor")),
    install: () => writeSkillFiles(join(HOME_DIRECTORY, ".cursor", "skills", SKILL_NAME)),
  },
  {
    name: "OpenCode",
    detect: () =>
      isCommandAvailable("opencode") || existsSync(join(HOME_DIRECTORY, ".config", "opencode")),
    install: () =>
      writeSkillFiles(join(HOME_DIRECTORY, ".config", "opencode", "skills", SKILL_NAME)),
  },
  {
    name: "Windsurf",
    detect: () =>
      existsSync(join(HOME_DIRECTORY, ".codeium")) ||
      existsSync(join(HOME_DIRECTORY, "Library", "Application Support", "Windsurf")),
    install: () => {
      const memoriesDirectory = join(HOME_DIRECTORY, ".codeium", "windsurf", "memories");
      mkdirSync(memoriesDirectory, { recursive: true });
      const rulesFile = join(memoriesDirectory, "global_rules.md");

      if (existsSync(rulesFile)) {
        const existingContent = readFileSync(rulesFile, "utf-8");
        if (existingContent.includes(WINDSURF_MARKER)) return;
        appendFileSync(rulesFile, `\n${WINDSURF_MARKER}\n\n${SKILL_CONTENT}`);
      } else {
        writeFileSync(rulesFile, `${WINDSURF_MARKER}\n\n${SKILL_CONTENT}`);
      }
    },
  },
  {
    name: "Antigravity",
    detect: () =>
      isCommandAvailable("agy") || existsSync(join(HOME_DIRECTORY, ".gemini", "antigravity")),
    install: () =>
      writeSkillFiles(join(HOME_DIRECTORY, ".gemini", "antigravity", "skills", SKILL_NAME)),
  },
  {
    name: "Gemini CLI",
    detect: () => isCommandAvailable("gemini") || existsSync(join(HOME_DIRECTORY, ".gemini")),
    install: () => writeSkillFiles(join(HOME_DIRECTORY, ".gemini", "skills", SKILL_NAME)),
  },
  {
    name: "Codex",
    detect: () => isCommandAvailable("codex") || existsSync(join(HOME_DIRECTORY, ".codex")),
    install: () => {
      const skillDirectory = join(HOME_DIRECTORY, ".codex", "skills", SKILL_NAME);
      writeSkillFiles(skillDirectory);
      const agentsDirectory = join(skillDirectory, "agents");
      mkdirSync(agentsDirectory, { recursive: true });
      writeFileSync(join(agentsDirectory, "openai.yaml"), CODEX_AGENT_CONFIG);
    },
  },
];

const installSkill = (): void => {
  let installedCount = 0;

  for (const target of SKILL_TARGETS) {
    if (!target.detect()) continue;
    try {
      target.install();
      logger.log(`  ${highlighter.success("✔")} ${target.name}`);
      installedCount++;
    } catch {
      logger.dim(`  ✗ ${target.name} (failed)`);
    }
  }

  try {
    const projectSkillDirectory = join(".agents", SKILL_NAME);
    writeSkillFiles(projectSkillDirectory);
    logger.log(`  ${highlighter.success("✔")} .agents/`);
    installedCount++;
  } catch {
    logger.dim("  ✗ .agents/ (failed)");
  }

  logger.break();
  if (installedCount === 0) {
    logger.dim("No supported tools detected.");
  } else {
    logger.success("Done! The skill will activate when working on React projects.");
  }
};

export const maybePromptSkillInstall = async (shouldSkipPrompts: boolean): Promise<void> => {
  const config = readSkillPromptConfig();
  if (config.skillPromptDismissed) return;
  if (shouldSkipPrompts) return;

  logger.break();
  logger.log(`${highlighter.info("💡")} Have your coding agent fix these issues automatically?`);
  logger.dim(
    `   Install the ${highlighter.info("react-doctor")} skill to teach Cursor, Claude Code,`,
  );
  logger.dim("   Ami, and other AI agents how to diagnose and fix React issues.");
  logger.break();

  const { shouldInstall } = await prompts({
    type: "confirm",
    name: "shouldInstall",
    message: "Install skill? (recommended)",
    initial: true,
  });

  if (shouldInstall) {
    logger.break();
    installSkill();
  }

  writeSkillPromptConfig({ ...config, skillPromptDismissed: true });
};
