import * as fs from "node:fs";
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
  readReactDoctorWorkflow,
  upgradeWorkflowActionToV2,
  workflowUsesV1Action,
  type InstalledReactDoctorWorkflow,
} from "./install-github-workflow.js";
import { hasHandledActionUpgrade, recordActionUpgradeDecision } from "./action-upgrade-prompt.js";
import { reportWorkflowResult } from "./report-workflow-result.js";
import { installReactDoctorSkillForAgent } from "./install-skill-for-agent.js";
import { isCommandAvailable } from "./is-command-available.js";
import { CI_TRUST_COMPANIES, METRIC } from "./constants.js";
import { openUrl } from "./open-url.js";
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
//
// When the workflow is freshly written AND the user has `gh` installed,
// `openWorkflowPullRequest` commits the YAML on a dedicated branch and
// opens a PR for review — that matches the "everything else lands as a
// reviewable PR" mental model teams already have for CI changes, instead
// of silently dropping a top-level workflow file into their working tree.
// On any failure (gh missing, not authenticated, push refused, …) we fall
// back to `git add`ing the file so it at least shows up in the user's
// next `git status` / commit instead of becoming an orphan untracked path.
const setUpGitHubActions = async (rootDirectory: string): Promise<void> => {
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
      `  Couldn't set up GitHub Actions automatically. Follow the guide at ${highlighter.info(CI_URL)}`,
    );
    return;
  }
  if (workflowResult.status === "created") {
    const pullRequestSpinner = spinner("Opening a pull request for review...").start();
    const pullRequestResult = await openWorkflowPullRequest({
      workflowPath: workflowResult.workflowPath,
    });
    if (pullRequestResult.status === "pr-opened") {
      pullRequestSpinner.succeed(
        `Opened pull request for review: ${highlighter.info(pullRequestResult.url)}`,
      );
    } else if (pullRequestResult.status === "branch-pushed") {
      pullRequestSpinner.warn(
        `Pushed branch ${highlighter.bold(pullRequestResult.branch)} but couldn't open a PR. Open one with: gh pr create --head ${pullRequestResult.branch}`,
      );
    } else {
      pullRequestSpinner.stop();
      const didStage = await stageWorkflowFile({ workflowPath: workflowResult.workflowPath });
      if (didStage) {
        logger.log(`  Staged the workflow file. Commit it to start scanning every pull request.`);
      } else {
        logger.log("  React Doctor will now scan every new pull request automatically.");
      }
    }
  }
  logger.log(`  Learn more: ${highlighter.info(CI_URL)}`);
};

const UPGRADE_YES_CHOICE = "upgrade-yes";
const UPGRADE_NO_CHOICE = "upgrade-no";

const UPGRADE_COMMIT_MESSAGE = "ci: upgrade React Doctor GitHub Action to v2";
const UPGRADE_PR_TITLE = "Upgrade React Doctor Action to v2";
const UPGRADE_PR_BODY = `Bumps the React Doctor GitHub Actions workflow to the action's latest major, \`millionco/react-doctor@v2\`.

Docs: https://www.react.doctor/ci`;

type UpgradePromptChoice = "yes" | "no" | "cancel";

// One-time-per-repo offer to bump an existing workflow from the action's
// previous floating major (`@v1`) to `@v2`. Two choices only — a "no" doubles
// as "don't ask again" (persisted by the caller). Cancel (Esc / Ctrl-C) is
// left un-answered so a stray keypress doesn't permanently suppress the offer.
const askUpgradeActionVersion = async (): Promise<UpgradePromptChoice> => {
  const { upgradeChoice } = await prompts<"upgradeChoice">(
    {
      type: "select",
      name: "upgradeChoice",
      message: "A new major of the React Doctor Action (v2) is out. Upgrade this repo's workflow?",
      hint: " ",
      choices: [
        {
          title: "Yes (recommended)",
          description: "Open a PR bumping the workflow to millionco/react-doctor@v2",
          value: UPGRADE_YES_CHOICE,
        },
        {
          title: "No, thanks",
          description: "Keep @v1 — won't ask again for this repo",
          value: UPGRADE_NO_CHOICE,
        },
      ],
      initial: 0,
    },
    { onCancel: () => true },
  );

  if (upgradeChoice === undefined) return "cancel";
  return upgradeChoice === UPGRADE_YES_CHOICE ? "yes" : "no";
};

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
  } else if (pullRequestResult.status === "branch-pushed") {
    upgradeSpinner.warn(
      `Pushed branch ${highlighter.bold(pullRequestResult.branch)} but couldn't open a PR. Open one with: gh pr create --head ${pullRequestResult.branch}`,
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
    const didStage = await stageWorkflowFile({ workflowPath: workflow.workflowPath });
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

// First handoff question, asked only when the GitHub Actions workflow isn't
// already on disk. Pulled out of the main handoff prompt so the agent
// selection below stays a clean "what runs next?" question instead of a
// multi-axis decision.
//
// The pitch (incremental backlog + social proof) lives as part of the
// `message` text, indented under the question itself so the value is
// visually attached to the action it justifies — printing those lines via
// `logger.log` before the prompt left them floating with a blank line
// between the value prop and the question, and users skip past floating
// preamble. `\x1b[22m` (SGR "bold off") cancels the bold the `prompts`
// `select` renderer wraps every message in (`select.js` line 131:
// `color.bold(this.msg)`), so the question stays bold while the indented
// pitch lines render in normal weight (and dim, for the social-proof
// tagline) — matching the original two-line layout's emphasis.
//
// `hint: " "` (single space — `""` would re-trigger the library's
// `opts.hint || "- Use arrow-keys..."` fallback) suppresses the verbose
// default hint so the trailing ` ›` rides quietly on the last pitch line
// instead of becoming a "› - Use arrow-keys. Return to submit." row that
// reads as broken UI between the pitch and the choices.
//
// "Learn more" opens the docs in the user's default browser via `openUrl` and
// re-prompts, so the user can decide after reading without restarting the
// CLI. Non-interactive runs never reach this function (the caller short-circuits
// on `!input.interactive`); cancel (Esc / Ctrl-C) maps to "no" so a stray
// keypress doesn't accidentally install workflow files.
type CiHandoffOutcome = "yes" | "no" | "cancel";

const SGR_BOLD_OFF = "\x1b[22m";

const ciQuestionMessage = [
  "Add React Doctor to GitHub Actions?",
  `${SGR_BOLD_OFF}  ${highlighter.dim("Scan every pull request to prevent new React issues while you fix the backlog.")}`,
  `${SGR_BOLD_OFF}  ${highlighter.dim(`Used by teams at ${CI_TRUST_COMPANIES}.`)}`,
].join("\n");

const askAddToGitHubActions = async (): Promise<CiHandoffOutcome> => {
  while (true) {
    const { ciChoice } = await prompts<"ciChoice">(
      {
        type: "select",
        name: "ciChoice",
        message: ciQuestionMessage,
        hint: " ",
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
      await setUpGitHubActions(input.rootDirectory);
      logger.break();
    }
  } else {
    // Workflow already present: offer the one-time `@v1` → `@v2` upgrade
    // instead. Mutually exclusive with the "add" prompt above.
    await maybeOfferActionUpgrade(projectRootForCi);
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
