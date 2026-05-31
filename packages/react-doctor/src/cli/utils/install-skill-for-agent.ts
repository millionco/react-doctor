import { existsSync } from "node:fs";
import { join } from "node:path";
import { installSkillsFromSource, SKILL_MANIFEST_FILE, type SkillAgentType } from "agent-install";
import { getSkillSourceDirectory } from "./install-react-doctor.js";

// Copies the bundled react-doctor skill into a single agent's skills dir so
// the agent we're handing off to already knows the `/react-doctor`
// workflow. Best-effort: returns false when the bundled skill is missing or
// the install reports any failure.
export const installReactDoctorSkillForAgent = async (
  agent: SkillAgentType,
  projectRoot: string,
): Promise<boolean> => {
  const source = getSkillSourceDirectory();
  if (!existsSync(join(source, SKILL_MANIFEST_FILE))) return false;
  const result = await installSkillsFromSource({
    source,
    agents: [agent],
    cwd: projectRoot,
    mode: "copy",
  });
  return result.skills.length > 0 && result.failed.length === 0;
};
