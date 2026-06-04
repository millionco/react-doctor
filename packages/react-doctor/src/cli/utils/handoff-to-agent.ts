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
import { openUrl } from "./open-url.js";
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

const CI_YES_CHOICE = "ci-yes";
const CI_LEARN_MORE_CHOICE = "ci-learn-more";
const CI_NO_CHOICE = "ci-no";
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
      `Couldn't set up GitHub Actions automatically. Follow the guide at ${highlighter.info(CI_URL)}`,
    );
    return;
  }
  if (workflowResult.status === "created") {
    logger.log("React Doctor will now scan every new pull request automatically.");
  }
  logger.log(`Learn more: ${highlighter.info(CI_URL)}`);
};

// First handoff question, asked only when the GitHub Actions workflow isn't
// already on disk. Pulled out of the main handoff prompt so the agent
// selection below stays a clean "what runs next?" question instead of a
// multi-axis decision. The pitch lives on a logger line above the question
// (always visible, not buried inside one focused choice's description), and
// the URL renders cyan via `highlighter.info` so it reads as a link in the
// terminal — matching how `GitHub:` is styled in the scan-report footer.
//
// "Learn more" opens the docs in the user's default browser via `openUrl` and
// re-prompts, so the user can decide after reading without restarting the
// CLI. Non-interactive runs never reach this function (the caller short-circuits
// on `!input.interactive`); cancel (Esc / Ctrl-C) maps to "no" so a stray
// keypress doesn't accidentally install workflow files.
type CiHandoffOutcome = "yes" | "no" | "cancel";

const askAddToGitHubActions = async (): Promise<CiHandoffOutcome> => {
  logger.log("React Doctor can scan every pull request via GitHub Actions.");
  logger.log(highlighter.dim(`Used by teams at ${CI_TRUST_COMPANIES}.`));
  logger.break();

  while (true) {
    const { ciChoice } = await prompts<"ciChoice">(
      {
        type: "select",
        name: "ciChoice",
        message: "Add React Doctor to GitHub Actions?",
        choices: [
          {
            title: "Yes (recommended)",
            description: "Adds the workflow file and a doctor package script",
            value: CI_YES_CHOICE,
          },
          {
            title: "Learn more",
            description: highlighter.info(CI_URL),
            value: CI_LEARN_MORE_CHOICE,
          },
          {
            title: "No, thanks",
            description: "Continue to the agent handoff",
            value: CI_NO_CHOICE,
          },
        ],
        initial: 0,
      },
      { onCancel: () => true },
    );

    if (ciChoice === undefined) return "cancel";
    if (ciChoice === CI_YES_CHOICE) return "yes";
    if (ciChoice === CI_NO_CHOICE) return "no";

    // CI_LEARN_MORE_CHOICE: open the docs and loop back to the question.
    const opened = openUrl(CI_URL);
    logger.log(
      opened
        ? `Opened ${highlighter.info(CI_URL)} in your browser.`
        : `Visit ${highlighter.info(CI_URL)} to learn more.`,
    );
    logger.break();
  }
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

// Two-phase post-scan handoff: first asks whether to wire up GitHub Actions
// (skipped when the workflow file is already on disk — that option would be a
// no-op), then asks where to send the diagnostics for triage. The split keeps
// each question single-axis: "should this codebase run React Doctor on every
// PR?" is a different decision than "where do you want to triage today's
// findings?", and combining them was confusing — the agent picker is the same
// choice the user makes every scan, the CI prompt is a one-time install. Both
// questions are skipped when non-interactive or there's nothing to hand off.
export const handoffToAgent = async (input: HandoffToAgentInput): Promise<void> => {
  if (!input.interactive || input.diagnostics.length === 0) return;

  logger.break();

  const projectRootForCi = findNearestPackageDirectory(input.rootDirectory) ?? input.rootDirectory;
  const isGitHubActionsConfigured = isReactDoctorWorkflowInstalled(projectRootForCi);

  // CI question first, only when it has anything to do. A "yes" sets up the
  // workflow inline and then falls through to the agent question, so a user
  // can install CI AND launch an agent in one scan — previously the combined
  // prompt forced an either/or choice.
  if (!isGitHubActionsConfigured) {
    const ciOutcome = await askAddToGitHubActions();
    recordCount(METRIC.agentHandoff, 1, {
      outcome: `ci-${ciOutcome}`,
      diagnosticsCount: input.diagnostics.length,
    });
    if (ciOutcome === "cancel") return;
    if (ciOutcome === "yes") {
      setUpGitHubActions(input.rootDirectory);
      logger.break();
    }
  }

  const launchableAgents = await detectLaunchableAgents();
  const { handoffTarget } = await prompts<"handoffTarget">(
    {
      type: "select",
      name: "handoffTarget",
      message: "What would you like to do next?",
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

  // Count the agent-handoff outcome (the second activation moment). The CI
  // outcome was counted separately above, since it's now its own question.
  // The `"launch"` / `"clipboard"` / `"skip"` / `"cancel"` values are preserved
  // for metric-history continuity with prior releases.
  let handoffOutcome = "launch";
  if (handoffTarget === undefined) handoffOutcome = "cancel";
  else if (handoffTarget === SKIP_CHOICE) handoffOutcome = "skip";
  else if (handoffTarget === CLIPBOARD_CHOICE) handoffOutcome = "clipboard";
  recordCount(METRIC.agentHandoff, 1, {
    outcome: handoffOutcome,
    agent: handoffOutcome === "launch" ? handoffTarget : undefined,
    diagnosticsCount: input.diagnostics.length,
  });

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
