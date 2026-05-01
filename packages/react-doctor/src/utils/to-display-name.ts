import { getSkillAgentConfig, type SkillAgentType } from "agent-install";

export const toDisplayName = (agent: SkillAgentType): string =>
  getSkillAgentConfig(agent).displayName;
