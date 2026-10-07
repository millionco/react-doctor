import { detectAvailableAgents } from "./detect-agents.js";
import { isCommandAvailable } from "./is-command-available.js";
import { CLI_AGENT_BINARIES, CLI_AGENT_IDS, type CliAgentId } from "./launch-agent.js";

export const detectLaunchableAgents = async (): Promise<CliAgentId[]> => {
  const detected = new Set(await detectAvailableAgents());
  return CLI_AGENT_IDS.filter(
    (agentId) => detected.has(agentId) && isCommandAvailable(CLI_AGENT_BINARIES[agentId]),
  );
};
