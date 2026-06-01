import { getSkillAgentConfig } from "agent-install";
import type { Diagnostic } from "@react-doctor/core";
import { highlighter } from "@react-doctor/core";
import { buildHandoffPayload } from "./build-handoff-payload.js";
import { cliLogger as logger } from "./cli-logger.js";
import { detectAvailableAgents } from "./detect-agents.js";
import { installReactDoctorSkillForAgent } from "./install-skill-for-agent.js";
import { isCommandAvailable } from "./is-command-available.js";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";
import {
  CLI_AGENT_BINARIES,
  type CliAgentId,
  copyToClipboard,
  launchCliAgent,
} from "./launch-agent.js";
import { prompts } from "./prompts.js";
import { spinner } from "./spinner.js";

export interface HandoffToAgentInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly projectName: string;
  readonly rootDirectory: string;
  readonly interactive: boolean;
}

const CLIPBOARD_CHOICE = "clipboard";
const SKIP_CHOICE = "skip";

const printPayload = (payload: string): void => {
  logger.break();
  logger.log(highlighter.dim("──── Agent prompt ────"));
  logger.log(payload);
  logger.log(highlighter.dim("──────────────────────"));
};

// CLI agents we can launch: detected as installed by `agent-install`
// (filesystem config dir) AND with their launch binary on PATH (since we
// hand the prompt to that CLI). `agent-install` has no command-availability
// check, so `isCommandAvailable` covers the launchability half.
const detectLaunchableAgents = async (): Promise<CliAgentId[]> => {
  const detected = new Set(await detectAvailableAgents());
  return (Object.keys(CLI_AGENT_BINARIES) as CliAgentId[]).filter(
    (agentId) => detected.has(agentId) && isCommandAvailable(CLI_AGENT_BINARIES[agentId]),
  );
};

// Prompts for an agent to hand the scan results to and launches it: a
// detected CLI agent takes over the current terminal with the top issues
// as its initial prompt, or the prompt is copied to the clipboard for pasting
// into any agent (and printed only if copy/launch fails). Non-interactive runs
// do nothing.
export const handoffToAgent = async (input: HandoffToAgentInput): Promise<void> => {
  if (!input.interactive || input.diagnostics.length === 0) return;

  logger.break();

  const launchableAgents = await detectLaunchableAgents();
  const { handoffTarget } = await prompts<"handoffTarget">(
    {
      type: "select",
      name: "handoffTarget",
      message: "Would you like to spawn an agent to fix these issues?",
      choices: [
        ...launchableAgents.map((agentId) => ({
          title: getSkillAgentConfig(agentId).displayName,
          description: `Open ${CLI_AGENT_BINARIES[agentId]} here with the top issues as a prompt`,
          value: agentId,
        })),
        {
          title: "Copy prompt to clipboard",
          description: "Paste into any agent or chat",
          value: CLIPBOARD_CHOICE,
        },
        { title: "Skip", description: "Don't hand off", value: SKIP_CHOICE },
      ],
      initial: 0,
    },
    { onCancel: () => true },
  );

  // Count the fix-loop outcome (the core activation moment): did the user launch
  // an agent (any agent id), copy the prompt, or skip/cancel?
  let handoffOutcome = "launch";
  if (handoffTarget === undefined) handoffOutcome = "cancel";
  else if (handoffTarget === SKIP_CHOICE) handoffOutcome = "skip";
  else if (handoffTarget === CLIPBOARD_CHOICE) handoffOutcome = "clipboard";
  recordCount(METRIC.agentHandoff, 1, {
    outcome: handoffOutcome,
    agent: handoffOutcome === "launch" ? handoffTarget : undefined,
    diagnosticsCount: input.diagnostics.length,
  });

  // Cancel (Esc / Ctrl-C) or "Skip" exits without writing the prompt/files.
  if (handoffTarget === undefined || handoffTarget === SKIP_CHOICE) return;

  const payload = buildHandoffPayload({
    diagnostics: input.diagnostics,
    projectName: input.projectName,
  });

  if (handoffTarget === CLIPBOARD_CHOICE) {
    const didCopy = await copyToClipboard(payload);
    if (didCopy) logger.log("Copied the prompt to your clipboard.");
    else printPayload(payload);
    return;
  }

  const agentId = handoffTarget as CliAgentId;
  const displayName = getSkillAgentConfig(agentId).displayName;

  // Install the /react-doctor skill for the agent we're handing off to, so
  // it already knows the triage workflow. Best-effort — never blocks the
  // handoff.
  const skillSpinner = spinner(`Installing the /react-doctor skill for ${displayName}...`).start();
  try {
    const installed = await installReactDoctorSkillForAgent(agentId, input.rootDirectory);
    if (installed) skillSpinner.succeed(`Installed the /react-doctor skill for ${displayName}.`);
    else skillSpinner.stop();
  } catch {
    skillSpinner.stop();
  }

  logger.log(highlighter.dim(`Handing off to ${displayName}...`));
  try {
    await launchCliAgent(agentId, payload, input.rootDirectory);
  } catch {
    logger.warn(`Couldn't launch ${CLI_AGENT_BINARIES[agentId]}. Here's the prompt instead:`);
    printPayload(payload);
  }
};
