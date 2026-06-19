import * as fs from "node:fs";
import { getSkillAgentConfig } from "agent-install";
import type { Diagnostic } from "@react-doctor/core";
import { highlighter } from "@react-doctor/core";
import { buildHandoffPayload } from "./build-handoff-payload.js";
import { cliLogger as logger } from "./cli-logger.js";
import { detectAvailableAgents } from "./detect-agents.js";
import { findNearestPackageDirectory } from "./install-doctor-script.js";
import {
  isReactDoctorWorkflowInstalled,
  readReactDoctorWorkflow,
  upgradeWorkflowActionToV2,
  workflowUsesV1Action,
  type InstalledReactDoctorWorkflow,
} from "./install-github-workflow.js";
import { hasHandledActionUpgrade, recordActionUpgradeDecision } from "./action-upgrade-prompt.js";
import { hasHandledCiPrompt, recordCiPromptDecision } from "./ci-prompt-decision.js";
import { askAddToGitHubActions } from "./ask-add-to-github-actions.js";
import { askUpgradeActionVersion } from "./ask-upgrade-action-version.js";
import { setUpGitHubActions } from "./set-up-github-actions.js";
import { installReactDoctorSkillForAgent } from "./install-skill-for-agent.js";
import { isCommandAvailable } from "./is-command-available.js";
import { METRIC } from "./constants.js";
import { openWorkflowPullRequest, stageWorkflowFile } from "./open-workflow-pull-request.js";
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
  readonly outputDirectory?: string | null;
}

const CLIPBOARD_CHOICE = "clipboard";
const SKIP_CHOICE = "skip";

const printPayload = (payload: string): void => {
  logger.break();
  logger.log(highlighter.dim("──── Agent prompt ────"));
  logger.log(payload);
  logger.log(highlighter.dim("──────────────────────"));
};

const UPGRADE_COMMIT_MESSAGE = "ci: upgrade React Doctor GitHub Action to v2";
const UPGRADE_PR_TITLE = "Upgrade React Doctor Action to v2";
const UPGRADE_PR_BODY = `Bumps the React Doctor GitHub Actions workflow to the action's latest major, \`millionco/react-doctor@v2\`.

Docs: https://www.react.doctor/ci`;

// Writes the `@v2` bump into the existing (tracked) workflow file and opens a
// PR for it — mirroring the fresh-install flow's commit-on-a-branch model so
// the change lands as a reviewable PR rather than a silent edit. On a PR-open
// success the user's working tree is restored to `@v1` (the bump lives only on
// the PR branch); when `gh` is unavailable we fall back to staging the edit so
// it shows up in their next commit. Returns whether the bump was applied: a
// write failure returns `false` so the caller doesn't record the offer as
// handled, leaving it to re-prompt on the next scan.
const upgradeGitHubActionsWorkflow = async (
  workflow: InstalledReactDoctorWorkflow,
): Promise<boolean> => {
  const { content, changed } = upgradeWorkflowActionToV2(workflow.content);
  if (!changed) return false;

  const upgradeSpinner = spinner("Opening a pull request to upgrade React Doctor to v2...").start();
  try {
    fs.writeFileSync(workflow.workflowPath, content);
  } catch {
    upgradeSpinner.fail("Couldn't update the workflow file.");
    return false;
  }

  const pullRequestResult = await openWorkflowPullRequest({
    workflowPath: workflow.workflowPath,
    commitMessage: UPGRADE_COMMIT_MESSAGE,
    prTitle: UPGRADE_PR_TITLE,
    prBody: UPGRADE_PR_BODY,
  });

  if (pullRequestResult.status === "pr-opened") {
    upgradeSpinner.succeed(
      `Opened pull request for review: ${highlighter.info(pullRequestResult.url)}`,
    );
  } else if (pullRequestResult.status === "pr-exists") {
    // `pr-exists` returns without touching git state, so the @v2 edit we wrote
    // above still sits uncommitted in the working tree. Restore the original
    // @v1 content — the bump lives on the already-open PR's branch — matching
    // the pr-opened path's "the bump lives only on the PR branch" contract so
    // the user can't accidentally commit a stray edit to their working branch.
    try {
      fs.writeFileSync(workflow.workflowPath, workflow.content);
    } catch {}
    upgradeSpinner.succeed(
      `A React Doctor pull request is already open: ${highlighter.info(pullRequestResult.url)}`,
    );
  } else if (pullRequestResult.status === "branch-pushed") {
    upgradeSpinner.warn(
      `Pushed branch ${highlighter.bold(
        pullRequestResult.branch,
      )} but couldn't open a PR. Open one with: gh pr create --head ${pullRequestResult.branch}`,
    );
  } else {
    upgradeSpinner.stop();
    // A git failure mid-flight (e.g. a rejected push) leaves openWorkflowPull-
    // Request having restored the original branch — reverting the tracked file
    // back to `@v1`. Re-write the bump so the working tree definitely lands on
    // `@v2` before staging, keeping the "updated to @v2" message honest (and the
    // recorded `accepted` decision truthful).
    try {
      fs.writeFileSync(workflow.workflowPath, content);
    } catch {
      logger.log("  Couldn't finish the upgrade. Re-run React Doctor to try again.");
      return false;
    }
    const didStage = await stageWorkflowFile({
      workflowPath: workflow.workflowPath,
    });
    logger.log(
      didStage
        ? "  Updated the workflow to @v2 and staged it. Commit it to finish the upgrade."
        : "  Updated the workflow to @v2. Commit the change to finish the upgrade.",
    );
  }

  return true;
};

// Offered once per repo: when a React Doctor workflow is already on disk but
// still pins the action's previous floating major (`@v1`), invite the user to
// bump it to `@v2` via a PR. A decline is persisted per-repo, and an accept
// only once the bump is actually applied, so the offer never repeats; a cancel
// (or a failed write) leaves it un-answered so the prompt can return next scan.
// The caller has already gated on an interactive run with findings.
const maybeOfferActionUpgrade = async (projectRoot: string): Promise<void> => {
  const workflow = readReactDoctorWorkflow(projectRoot);
  if (!workflow || !workflowUsesV1Action(workflow.content)) return;
  if (hasHandledActionUpgrade(projectRoot)) return;

  const outcome = await askUpgradeActionVersion();
  if (outcome === "cancel") return;

  recordCount(METRIC.agentHandoff, 1, {
    outcome: outcome === "yes" ? "upgrade-accepted" : "upgrade-declined",
  });

  if (outcome === "no") {
    recordActionUpgradeDecision(projectRoot, "declined");
    return;
  }

  const didApplyUpgrade = await upgradeGitHubActionsWorkflow(workflow);
  if (didApplyUpgrade) recordActionUpgradeDecision(projectRoot, "accepted");
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
  // The CI pitch is once-per-repo: ask only when the repo has neither a workflow
  // nor a prior answer. Subsequent scans stay quiet. (The agent copy-prompt
  // deliberately carries no CI upsell — this interactive prompt is the single
  // pitch, so the agent never re-asks what the user was just asked here.)
  const isCiPitchPending = !isGitHubActionsConfigured && !hasHandledCiPrompt(projectRootForCi);

  // CI question first, only when it has anything to do. A "yes" sets up the
  // workflow inline and then falls through to the agent question, so a user
  // can install CI AND launch an agent in one scan — previously the combined
  // prompt forced an either/or choice.
  if (isCiPitchPending) {
    const ciOutcome = await askAddToGitHubActions();
    recordCount(METRIC.agentHandoff, 1, {
      outcome: `ci-${ciOutcome}`,
      diagnosticsCount: input.diagnostics.length,
    });
    if (ciOutcome === "cancel") return;
    // Remember the answer either way so the pitch never repeats on this repo.
    recordCiPromptDecision(projectRootForCi, ciOutcome === "yes" ? "accepted" : "declined");
    if (ciOutcome === "yes") {
      await setUpGitHubActions({ rootDirectory: input.rootDirectory });
      logger.break();
    }
  } else if (isGitHubActionsConfigured) {
    // Workflow already present: offer the one-time `@v1` → `@v2` upgrade
    // instead. Mutually exclusive with the "add" prompt above.
    await maybeOfferActionUpgrade(projectRootForCi);
  } else {
    // Not configured, but the user already answered the CI pitch for this repo.
    // Stay quiet so the pitch is once-per-repo rather than every scan.
    recordCount(METRIC.agentHandoff, 1, {
      outcome: "ci-suppressed",
      diagnosticsCount: input.diagnostics.length,
    });
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
    outputDirectory: input.outputDirectory,
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
