import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { type SupportedAgent, toSkillDir } from "./detect-agents.js";

export const installSkillForAgent = (
  projectRoot: string,
  agent: SupportedAgent,
  skillSourceDirectory: string,
  skillName: string,
): string => {
  const installedSkillDirectory = path.join(projectRoot, toSkillDir(agent), skillName);
  rmSync(installedSkillDirectory, { recursive: true, force: true });
  mkdirSync(path.dirname(installedSkillDirectory), { recursive: true });
  cpSync(skillSourceDirectory, installedSkillDirectory, { recursive: true });
  return installedSkillDirectory;
};
