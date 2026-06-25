import * as path from "node:path";
import * as fs from "node:fs";
import { CI_URL, GITHUB_ACTIONS_SETUP_URL, highlighter } from "@react-doctor/core";
import { cliLogger as logger } from "../cli-logger.js";
import { METRIC } from "../constants.js";
import { detectDefaultBranch } from "../detect-default-branch.js";
import { findNearestPackageDirectory } from "../install-doctor-script.js";
import {
  openWorkflowPullRequest,
  stageWorkflowFile,
  type OpenWorkflowPullRequestResult,
} from "../open-workflow-pull-request.js";
import { prompts } from "../prompts.js";
import { recordCount } from "../record-metric.js";
import { runCommand, type CommandRunner } from "../run-command.js";
import { shouldSkipPrompts } from "../should-skip-prompts.js";
import { spinner } from "../spinner.js";
import {
  ADVISORY_GATE,
  BLOCKING_CHOICES,
  SCOPE_CHOICES,
  TOGGLE_INFO,
  gatesEqual,
  summarizeGate,
  type CiGate,
  type CiProvider,
} from "./ci-provider.js";
import { CI_PROVIDERS, getCiProvider, isCiProviderId } from "./ci-provider-registry.js";
import { detectCiProvider } from "./detect-ci-provider.js";
import { githubActionsProvider } from "./github-actions-provider.js";
import { applyGateFlags, hasAnyGateFlag } from "./resolve-ci-gate.js";
import type { MetricAttributes } from "../record-metric.js";

// Shared shape for `ci install` / `ci upgrade` / `ci config`. The gate flags
// are optional on every command: `ci install` bakes them into a fresh file,
// `ci config` edits an existing one, and `ci upgrade` ignores them.
export interface CiCommandOptions {
  cwd?: string;
  yes?: boolean;
  provider?: string;
  pr?: boolean;
  blocking?: string;
  scope?: string;
  comment?: boolean;
  reviewComments?: boolean;
  commitStatus?: boolean;
  // Injectable for tests; production callers leave these unset.
  prompt?: typeof prompts;
  run?: CommandRunner;
}

const resolveProjectRoot = (options: CiCommandOptions): string => {
  const requestedDirectory = path.resolve(options.cwd ?? process.cwd());
  return findNearestPackageDirectory(requestedDirectory) ?? requestedDirectory;
};

const setupDocsUrl = (provider: CiProvider): string =>
  provider.id === "github-actions" ? GITHUB_ACTIONS_SETUP_URL : CI_URL;

// Resolves the CI backend: an explicit `--provider`, else autodetection, else a
// prompt (or GitHub Actions when prompts are off). Returns null when the user
// passed an unknown id (after reporting it) so the caller stops cleanly.
const resolveProvider = async (
  options: CiCommandOptions,
  projectRoot: string,
  prompt: typeof prompts,
  skipPrompts: boolean,
  run: CommandRunner,
): Promise<CiProvider | null> => {
  if (options.provider !== undefined) {
    if (!isCiProviderId(options.provider)) {
      logger.error(
        `Unknown --provider "${options.provider}". Expected one of: ${CI_PROVIDERS.map((provider) => provider.id).join(", ")}.`,
      );
      process.exitCode = 1;
      return null;
    }
    return getCiProvider(options.provider);
  }

  const detected = await detectCiProvider(projectRoot, run);
  if (detected !== null) return getCiProvider(detected);

  if (skipPrompts) {
    logger.dim("No CI provider detected; using GitHub Actions. Pass --provider to choose.");
    return githubActionsProvider;
  }

  const { providerId } = await prompt<"providerId">({
    type: "select",
    name: "providerId",
    message: "Which CI provider does this repository use?",
    hint: " ",
    choices: CI_PROVIDERS.map((provider) => ({
      title: provider.displayName,
      value: provider.id,
      description:
        provider.id === "github-actions"
          ? "Pass or fail the check, comment on pull requests, post the score"
          : "Pass or fail the check on findings",
    })),
    initial: 0,
  });
  if (providerId === undefined || !isCiProviderId(providerId)) return null;
  return getCiProvider(providerId);
};

// Flags a provider can't honor (e.g. `--comment` on GitLab) so the user isn't
// left thinking a setting took effect when it was dropped.
const warnUnsupportedGateFlags = (provider: CiProvider, options: CiCommandOptions): void => {
  const unsupported: string[] = [];
  if (options.comment !== undefined && !provider.supportedGateKeys.includes("comment")) {
    unsupported.push("--comment");
  }
  if (
    options.reviewComments !== undefined &&
    !provider.supportedGateKeys.includes("reviewComments")
  ) {
    unsupported.push("--review-comments");
  }
  if (options.commitStatus !== undefined && !provider.supportedGateKeys.includes("commitStatus")) {
    unsupported.push("--commit-status");
  }
  if (unsupported.length > 0) {
    logger.warn(`${provider.displayName} doesn't support ${unsupported.join(", ")}; ignoring.`);
  }
};

const printIndentedBlock = (block: string): void => {
  for (const line of block.split("\n")) logger.dim(`    ${line}`);
};

// The plain-language recap printed after a scaffold or edit, so a user knows
// what they just turned on without reading the YAML.
const printGateSummary = (provider: CiProvider, gate: CiGate): void => {
  logger.break();
  logger.log("  React Doctor will now:");
  for (const line of summarizeGate(gate, provider.supportedGateKeys)) {
    logger.dim(`    • ${line}`);
  }
};

const gateMetricAttributes = (provider: CiProvider, gate: CiGate): MetricAttributes => ({
  blocking: gate.blocking,
  scope: gate.scope,
  comment: provider.supportedGateKeys.includes("comment") ? gate.comment : null,
  reviewComments: provider.supportedGateKeys.includes("reviewComments")
    ? gate.reviewComments
    : null,
  commitStatus: provider.supportedGateKeys.includes("commitStatus") ? gate.commitStatus : null,
});

const choiceIndex = <Value extends string>(
  choices: ReadonlyArray<{ readonly value: Value }>,
  value: Value,
): number =>
  Math.max(
    0,
    choices.findIndex((choice) => choice.value === value),
  );

// The interactive gate editor: one select for the gate level, one for scope,
// and a multiselect for the reporting toggles the provider supports. Pre-fills
// every field with the current value so a user changes only what they mean to.
const promptForGate = async (
  provider: CiProvider,
  currentGate: CiGate,
  prompt: typeof prompts,
): Promise<CiGate | null> => {
  const supported = provider.supportedGateKeys;
  const supportedToggles = TOGGLE_INFO.filter((toggle) => supported.includes(toggle.key));

  const answers = await prompt<"blocking" | "scope" | "toggles">([
    {
      type: "select",
      name: "blocking",
      message: "When a scan finds a new issue, what should happen?",
      hint: " ",
      choices: BLOCKING_CHOICES.map((choice) => ({
        title: choice.title,
        value: choice.value,
        description: choice.description,
      })),
      initial: choiceIndex(BLOCKING_CHOICES, currentGate.blocking),
    },
    {
      type: "select",
      name: "scope",
      message: "Which issues should a pull-request scan report?",
      hint: " ",
      choices: SCOPE_CHOICES.map((choice) => ({
        title: choice.title,
        value: choice.value,
        description: choice.description,
      })),
      initial: choiceIndex(SCOPE_CHOICES, currentGate.scope),
    },
    ...(supportedToggles.length > 0
      ? [
          {
            type: "multiselect" as const,
            name: "toggles" as const,
            message: "Pull request reporting (space to toggle, enter to confirm):",
            instructions: false,
            choices: supportedToggles.map((toggle) => ({
              title: toggle.title,
              value: toggle.key,
              description: toggle.description,
              selected: currentGate[toggle.key],
            })),
          },
        ]
      : []),
  ]);

  // A cancelled select yields `undefined`; bail without writing anything.
  if (answers.blocking === undefined || answers.scope === undefined) return null;

  const enabledToggles: ReadonlyArray<string> = answers.toggles ?? [];
  const toggleValue = (key: (typeof TOGGLE_INFO)[number]["key"]): boolean =>
    supported.includes(key) ? enabledToggles.includes(key) : currentGate[key];

  return {
    blocking: answers.blocking,
    scope: answers.scope,
    comment: toggleValue("comment"),
    reviewComments: toggleValue("reviewComments"),
    commitStatus: toggleValue("commitStatus"),
  };
};

// Opens a pull request for an already-written file and reports the outcome on a
// spinner, falling back to staging the file when a PR can't be opened (no `gh`,
// not authenticated, dirty tree, …). Returns the mode for telemetry.
const openCiPullRequest = async (params: {
  workflowPath: string;
  baseBranch: string;
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
}): Promise<"pr" | "tree"> => {
  const pullRequestSpinner = spinner("Opening a pull request for review...").start();
  const result: OpenWorkflowPullRequestResult = await openWorkflowPullRequest(params);
  if (result.status === "pr-opened") {
    pullRequestSpinner.succeed(`Opened pull request for review: ${highlighter.info(result.url)}`);
    return "pr";
  }
  if (result.status === "pr-exists") {
    pullRequestSpinner.succeed(
      `A React Doctor pull request is already open: ${highlighter.info(result.url)}`,
    );
    return "pr";
  }
  if (result.status === "branch-pushed") {
    pullRequestSpinner.warn(
      `Pushed ${highlighter.bold(result.branch)} but couldn't open a PR. Open one with: gh pr create --head ${result.branch}`,
    );
    return "pr";
  }
  pullRequestSpinner.stop();
  const didStage = await stageWorkflowFile({ workflowPath: params.workflowPath });
  logger.dim(
    didStage
      ? "  Staged the change. Commit it to apply."
      : "  Review and commit the change to apply it.",
  );
  return "tree";
};

export const runCiInstall = async (options: CiCommandOptions = {}): Promise<void> => {
  const projectRoot = resolveProjectRoot(options);
  const prompt = options.prompt ?? prompts;
  const run = options.run ?? runCommand;
  const skipPrompts = shouldSkipPrompts({ yes: options.yes });

  const provider = await resolveProvider(options, projectRoot, prompt, skipPrompts, run);
  if (provider === null) return;

  warnUnsupportedGateFlags(provider, options);
  const { gate, error } = applyGateFlags(ADVISORY_GATE, options);
  if (error !== null) {
    logger.error(error);
    process.exitCode = 1;
    return;
  }

  const defaultBranch =
    provider.id === "github-actions"
      ? ((await detectDefaultBranch(projectRoot, run)) ?? "main")
      : "main";

  const scaffoldSpinner = spinner(`Adding ${provider.displayName} workflow...`).start();
  const result = provider.scaffold(projectRoot, defaultBranch, gate);

  if (result.status === "failed") {
    scaffoldSpinner.fail(`Couldn't write ${provider.fileLabel}.`);
    logger.dim(`  Set it up by hand: ${highlighter.info(setupDocsUrl(provider))}`);
    return;
  }

  if (result.status === "exists") {
    scaffoldSpinner.succeed(
      `${path.relative(projectRoot, result.path)} already configured React Doctor.`,
    );
    if (provider.id === "github-actions") {
      // The file is left untouched, so any gate flags weren't applied — say so
      // and point at the command that does edit an existing workflow.
      logger.dim(
        hasAnyGateFlag(options)
          ? `  Left unchanged, so those settings weren't applied. Set them with ${highlighter.info("react-doctor ci config")}.`
          : `  Change its settings with ${highlighter.info("react-doctor ci config")}.`,
      );
    } else {
      logger.break();
      logger.log("  Add this job to your existing config:");
      printIndentedBlock(provider.renderSnippet(gate));
    }
    recordCount(METRIC.ciScaffolded, 1, {
      provider: provider.id,
      mode: "exists",
      ...gateMetricAttributes(provider, gate),
    });
    return;
  }

  scaffoldSpinner.succeed(`Added ${provider.fileLabel}.`);

  let mode: "pr" | "tree" = "tree";
  if (provider.supportsPullRequest && options.pr) {
    mode = await openCiPullRequest({ workflowPath: result.path, baseBranch: defaultBranch });
  } else {
    logger.dim("  Review and commit it to start scanning every pull request.");
  }

  printGateSummary(provider, gate);
  logger.log(`  Learn more: ${highlighter.info(setupDocsUrl(provider))}`);

  recordCount(METRIC.ciScaffolded, 1, {
    provider: provider.id,
    mode,
    ...gateMetricAttributes(provider, gate),
  });
};

export const runCiUpgrade = async (options: CiCommandOptions = {}): Promise<void> => {
  const projectRoot = resolveProjectRoot(options);
  const prompt = options.prompt ?? prompts;
  const run = options.run ?? runCommand;
  const skipPrompts = shouldSkipPrompts({ yes: options.yes });

  const provider = await resolveProvider(options, projectRoot, prompt, skipPrompts, run);
  if (provider === null) return;

  const workflow = provider.readWorkflow(projectRoot);
  if (workflow === null) {
    logger.error(`No ${provider.displayName} workflow found.`);
    logger.dim(`  Run ${highlighter.info("react-doctor ci install")} to add one first.`);
    process.exitCode = 1;
    return;
  }

  if (provider.upgradeMajor === undefined) {
    logger.log(
      `${provider.displayName} runs ${highlighter.info("npx react-doctor@latest")}, so it always uses the current release. Nothing to upgrade.`,
    );
    return;
  }

  const edit = provider.upgradeMajor(workflow.content);
  if (!edit.changed) {
    // Nothing was rewritten: the workflow either already uses the current
    // floating major or pins a specific version/SHA we shouldn't bump. Don't
    // claim it's on `@v2` when it might be deliberately pinned elsewhere.
    logger.success(
      `Nothing to upgrade: your workflow doesn't use the floating ${highlighter.info("@v1")} ref.`,
    );
    return;
  }

  let mode: "pr" | "tree" = "tree";
  const upgradeCopy = {
    commitMessage: "ci: upgrade React Doctor action to v2",
    prTitle: "Upgrade React Doctor action to v2",
    prBody:
      "Bumps the React Doctor GitHub Action to its current major (`@v2`).\n\nDocs: https://www.react.doctor/ci",
  };

  if (provider.supportsPullRequest && options.pr) {
    try {
      fs.writeFileSync(workflow.path, edit.content);
    } catch {
      logger.error(`Couldn't update ${path.relative(projectRoot, workflow.path)}.`);
      process.exitCode = 1;
      return;
    }
    mode = await openCiPullRequest({
      workflowPath: workflow.path,
      baseBranch: (await detectDefaultBranch(projectRoot, run)) ?? "main",
      ...upgradeCopy,
    });
  } else {
    const upgradeSpinner = spinner("Upgrading workflow to @v2...").start();
    try {
      fs.writeFileSync(workflow.path, edit.content);
      upgradeSpinner.succeed(
        `Upgraded to ${highlighter.info("@v2")} at ${path.relative(projectRoot, workflow.path)}.`,
      );
    } catch {
      upgradeSpinner.fail(`Couldn't update ${path.relative(projectRoot, workflow.path)}.`);
      process.exitCode = 1;
      return;
    }
    logger.dim("  Review and commit the change.");
  }

  recordCount(METRIC.ciUpgraded, 1, { provider: provider.id, mode });
};

export const runCiConfig = async (options: CiCommandOptions = {}): Promise<void> => {
  const projectRoot = resolveProjectRoot(options);
  const prompt = options.prompt ?? prompts;
  const run = options.run ?? runCommand;
  const skipPrompts = shouldSkipPrompts({ yes: options.yes });

  const provider = await resolveProvider(options, projectRoot, prompt, skipPrompts, run);
  if (provider === null) return;

  const workflow = provider.readWorkflow(projectRoot);
  if (workflow === null) {
    logger.error(`No ${provider.displayName} workflow found.`);
    logger.dim(`  Run ${highlighter.info("react-doctor ci install")} to add one first.`);
    process.exitCode = 1;
    return;
  }

  // The file can exist without wiring up React Doctor (a `.gitlab-ci.yml` is
  // often a full pipeline with no scan job); say so plainly instead of treating
  // its absent gate as advisory and offering an edit that can't land.
  if (!provider.containsReactDoctor(workflow.content)) {
    logger.error(`${path.relative(projectRoot, workflow.path)} has no React Doctor job.`);
    logger.dim(`  Run ${highlighter.info("react-doctor ci install")} to add one first.`);
    process.exitCode = 1;
    return;
  }

  warnUnsupportedGateFlags(provider, options);
  const currentGate = provider.parseGate(workflow.content);

  // Flags (or a non-interactive shell) apply exactly what was passed; otherwise
  // the prompts walk the user through each setting, pre-filled with the current
  // value.
  let nextGate: CiGate;
  if (hasAnyGateFlag(options)) {
    const { gate, error } = applyGateFlags(currentGate, options);
    if (error !== null) {
      logger.error(error);
      process.exitCode = 1;
      return;
    }
    nextGate = gate;
  } else if (skipPrompts) {
    logger.log(`Current ${provider.displayName} settings:`);
    for (const line of summarizeGate(currentGate, provider.supportedGateKeys)) {
      logger.dim(`  • ${line}`);
    }
    logger.dim("  Pass --blocking, --scope, or a reporting flag to change them.");
    return;
  } else {
    const promptedGate = await promptForGate(provider, currentGate, prompt);
    if (promptedGate === null) return;
    nextGate = promptedGate;
  }

  if (gatesEqual(nextGate, currentGate)) {
    logger.log("No changes. Your settings already match.");
    recordCount(METRIC.ciConfigured, 1, {
      provider: provider.id,
      applied: false,
      ...gateMetricAttributes(provider, nextGate),
    });
    return;
  }

  const edit = provider.applyGate(workflow.content, nextGate);
  if (edit === null) {
    logger.warn(
      `Couldn't edit ${path.relative(projectRoot, workflow.path)} automatically: it's been customized.`,
    );
    logger.dim("  Apply these settings by hand:");
    printIndentedBlock(provider.renderSnippet(nextGate));
    recordCount(METRIC.ciConfigured, 1, {
      provider: provider.id,
      applied: false,
      ...gateMetricAttributes(provider, nextGate),
    });
    return;
  }

  const configSpinner = spinner(`Updating ${provider.fileLabel}...`).start();
  try {
    fs.writeFileSync(workflow.path, edit.content);
    configSpinner.succeed(`Updated ${path.relative(projectRoot, workflow.path)}.`);
  } catch {
    configSpinner.fail(`Couldn't write ${path.relative(projectRoot, workflow.path)}.`);
    process.exitCode = 1;
    return;
  }

  printGateSummary(provider, nextGate);
  recordCount(METRIC.ciConfigured, 1, {
    provider: provider.id,
    applied: true,
    ...gateMetricAttributes(provider, nextGate),
  });
};
