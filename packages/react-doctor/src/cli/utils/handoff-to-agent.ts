import { getSkillAgentConfig } from "agent-install";
import type { Diagnostic } from "@react-doctor/core";
import { CI_URL, highlighter } from "@react-doctor/core";
import { buildHandoffPayload } from "./build-handoff-payload.js";
import { cliLogger as logger } from "./cli-logger.js";
import { detectAvailableAgents } from "./detect-agents.js";
import { findNearestPackageDirectory } from "./install-doctor-script.js";
import { installReactDoctorScriptStep } from "./install-react-doctor.js";
import {
  installReactDoctorWorkflow,
  isReactDoctorWorkflowInstalled,
} from "./install-github-workflow.js";
import { reportWorkflowResult } from "./report-workflow-result.js";
import { installReactDoctorSkillForAgent } from "./install-skill-for-agent.js";
import { isCommandAvailable } from "./is-command-available.js";
import { CI_TRUST_COMPANIES, METRIC } from "./constants.js";
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

const CI_CHOICE = "ci";
const CLIPBOARD_CHOICE = "clipboard";
const SKIP_CHOICE = "skip";

const printPayload = (payload: string): void => {
  logger.break();
  logger.log(highlighter.dim("──── Agent prompt ────"));
  logger.log(payload);
  logger.log(highlighter.dim("──────────────────────"));
};

// Sets React Doctor up to scan every pull request: writes the GitHub Actions
// workflow + adds a `doctor` package script (which runs `npx react-doctor@latest`,
// no local dep required). The local dev-dep install isn't called from this path:
// nothing here needs it, and on pnpm with a beta channel it noisily trips the
// supply-chain trust guard for zero user benefit. Users who actually want a
// pinned local copy go through the `react-doctor install` command. Resolves the
// nearest package root first (mirroring `install`) so a nested scan directory
// doesn't drop the workflow in the wrong place. The script step throws on a
// read-only / permission-denied FS, so it's guarded: a failed setup must
// never crash a scan that already succeeded.
//
// The post-pick message is intentionally lean: the scan-report footer's
// `GitHub Actions:` entry (`printFooter`) already made the case before the
// user clicked, so repeating the social-proof + backlog talking points here
// would be redundant noise. Confirm what changed, link the guide for deeper
// reading, done.
const setUpGitHubActions = (rootDirectory: string): void => {
  const projectRoot = findNearestPackageDirectory(rootDirectory) ?? rootDirectory;
  try {
    installReactDoctorScriptStep(projectRoot);
  } catch {}

  const workflowSpinner = spinner("Adding GitHub Actions workflow...").start();
  const workflowResult = installReactDoctorWorkflow(projectRoot);
  reportWorkflowResult(workflowSpinner, workflowResult, projectRoot);

  logger.break();
  if (workflowResult.status === "failed") {
    logger.log(
      `Couldn't set up GitHub Actions automatically. Add React Doctor to your pull requests with the guide: ${highlighter.dim(CI_URL)}`,
    );
    return;
  }
  if (workflowResult.status === "created") {
    logger.log("React Doctor will now scan every new pull request automatically.");
  }
  logger.log(`Learn more: ${highlighter.dim(CI_URL)}`);
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

  // Drop the "Add to GitHub Actions" choice entirely when the workflow file
  // is already present: picking it would be a no-op, and listing an option
  // whose only outcome is "✔ GitHub Actions workflow already configured" is
  // clutter. The scan-report footer's `GitHub Actions:` entry still appears
  // for those users as an informational link to the docs + social proof.
  const projectRootForCi = findNearestPackageDirectory(input.rootDirectory) ?? input.rootDirectory;
  const isGitHubActionsConfigured = isReactDoctorWorkflowInstalled(projectRootForCi);

  const launchableAgents = await detectLaunchableAgents();
  const { handoffTarget } = await prompts<"handoffTarget">(
    {
      type: "select",
      name: "handoffTarget",
      message: "What would you like to do next?",
      choices: [
        ...(isGitHubActionsConfigured
          ? []
          : [
              {
                title: "Add to GitHub Actions (recommended)",
                description: "Set up the workflow file + the doctor package script",
                value: CI_CHOICE,
              },
            ]),
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

  // Count the fix-loop outcome (the core activation moment): did the user set
  // up GitHub Actions, launch an agent (any agent id), copy the prompt, or
  // skip/cancel? The outcome value stays `"ci"` for metric-history continuity
  // with prior releases — only the user-facing wording changed.
  let handoffOutcome = "launch";
  if (handoffTarget === undefined) handoffOutcome = "cancel";
  else if (handoffTarget === CI_CHOICE) handoffOutcome = "ci";
  else if (handoffTarget === SKIP_CHOICE) handoffOutcome = "skip";
  else if (handoffTarget === CLIPBOARD_CHOICE) handoffOutcome = "clipboard";
  recordCount(METRIC.agentHandoff, 1, {
    outcome: handoffOutcome,
    agent: handoffOutcome === "launch" ? handoffTarget : undefined,
    diagnosticsCount: input.diagnostics.length,
  });

  // Cancel (Esc / Ctrl-C) or "Skip" exits without writing the prompt/files.
  if (handoffTarget === undefined || handoffTarget === SKIP_CHOICE) return;

  if (handoffTarget === CI_CHOICE) {
    setUpGitHubActions(input.rootDirectory);
    return;
  }

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
