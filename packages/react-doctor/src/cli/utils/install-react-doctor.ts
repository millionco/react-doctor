import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import {
  getSkillAgentConfig,
  installSkillsFromSource,
  SKILL_MANIFEST_FILE,
  type SkillAgentType,
} from "agent-install";
import { highlighter, SKILL_NAME } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { detectAvailableAgents } from "./detect-agents.js";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";
import {
  DOCTOR_PACKAGE_NAME,
  findNearestPackageDirectory,
  hasDoctorDependency,
  installReactDoctorScriptStep,
} from "./install-doctor-script.js";
import { askAddToGitHubActions } from "./ask-add-to-github-actions.js";
import { askUpgradeActionVersion } from "./ask-upgrade-action-version.js";
import { detectDefaultBranch } from "./detect-default-branch.js";
import { hasHandledActionUpgrade, recordActionUpgradeDecision } from "./action-upgrade-prompt.js";
import { hasHandledCiPrompt, recordCiPromptDecision } from "./ci-prompt-decision.js";
import { installReactDoctorAgentHooks } from "./install-agent-hooks.js";
import {
  getReactDoctorWorkflowPath,
  installReactDoctorWorkflow,
  readReactDoctorWorkflow,
  upgradeReactDoctorWorkflowInPlace,
  workflowUsesV1Action,
} from "./install-github-workflow.js";
import { reportWorkflowResult } from "./report-workflow-result.js";
import { isRecord, readPackageJson } from "./git-hook-shared.js";
import { GitHookKind, type GitHookTarget } from "./git-hook-types.js";
import { detectGitHookTarget, installReactDoctorGitHook } from "./install-git-hook.js";
import { prompts } from "./prompts.js";
import { shouldSkipPrompts } from "./should-skip-prompts.js";
import { spinner } from "./spinner.js";

const SETUP_OPTION_GIT_HOOK = "git-hook";
const SETUP_OPTION_AGENT_HOOKS = "agent-hooks";
const SETUP_OPTION_SKIP = "skip";

const CONFIG_ONLY_GIT_HOOK_KINDS = new Set([
  GitHookKind.Ghooks,
  GitHookKind.GitHooksJs,
  GitHookKind.Lefthook,
  GitHookKind.Overcommit,
  GitHookKind.PreCommit,
  GitHookKind.PreCommitNpm,
  GitHookKind.PrettyQuick,
  GitHookKind.SimpleGitHooks,
  GitHookKind.Yorkie,
]);

export interface InstallReactDoctorDependencyRunnerInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}

interface InstallReactDoctorDependencyOptions {
  readonly projectRoot: string;
  readonly runner?: (input: InstallReactDoctorDependencyRunnerInput) => void | Promise<void>;
}

interface InstallReactDoctorDependencyResult {
  readonly dependencyStatus: "created" | "existing" | "skipped";
  readonly dependencyReason?:
    | "missing-or-invalid-package-json"
    | "invalid-dev-dependencies"
    | "install-command-failed"
    | "trust-policy-blocked";
  readonly installCommand?: string;
}

const PACKAGE_MANAGER_LOCKFILES = [
  { packageManager: "pnpm", fileName: "pnpm-lock.yaml" },
  { packageManager: "yarn", fileName: "yarn.lock" },
  { packageManager: "bun", fileName: "bun.lockb" },
  { packageManager: "bun", fileName: "bun.lock" },
  { packageManager: "npm", fileName: "package-lock.json" },
] as const;

type PackageManager = (typeof PACKAGE_MANAGER_LOCKFILES)[number]["packageManager"] | "npm";

const findNearestFileDirectory = (
  startDirectory: string,
  fileNames: ReadonlyArray<string>,
): string | null => {
  let currentDirectory = path.resolve(startDirectory);
  while (true) {
    if (fileNames.some((fileName) => fs.existsSync(path.join(currentDirectory, fileName)))) {
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
};

const detectPackageManager = (projectRoot: string): PackageManager => {
  let currentDirectory = path.resolve(projectRoot);
  while (true) {
    const packageJson = readPackageJson(currentDirectory);
    if (isRecord(packageJson) && typeof packageJson.packageManager === "string") {
      const packageManagerName = packageJson.packageManager.split("@")[0];
      if (
        packageManagerName === "pnpm" ||
        packageManagerName === "yarn" ||
        packageManagerName === "bun" ||
        packageManagerName === "npm"
      ) {
        return packageManagerName;
      }
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  const lockfileDirectory = findNearestFileDirectory(
    projectRoot,
    PACKAGE_MANAGER_LOCKFILES.map((lockfile) => lockfile.fileName),
  );
  const matchedLockfile = PACKAGE_MANAGER_LOCKFILES.find(
    (lockfile) =>
      lockfileDirectory !== null && fs.existsSync(path.join(lockfileDirectory, lockfile.fileName)),
  );
  return matchedLockfile?.packageManager ?? "npm";
};

const packageManagerNeedsWorkspaceFlag = (projectRoot: string): boolean =>
  fs.existsSync(path.join(projectRoot, "pnpm-workspace.yaml")) ||
  findNearestFileDirectory(projectRoot, ["pnpm-workspace.yaml"]) !== null;

const buildInstallCommand = (projectRoot: string): InstallReactDoctorDependencyRunnerInput => {
  const packageManager = detectPackageManager(projectRoot);
  const packageSpecifier = `${DOCTOR_PACKAGE_NAME}@latest`;
  if (packageManager === "npm") {
    return {
      command: "npm",
      args: ["install", "--save-dev", packageSpecifier],
      cwd: projectRoot,
    };
  }
  if (packageManager === "yarn") {
    return {
      command: "yarn",
      args: ["add", "--dev", packageSpecifier],
      cwd: projectRoot,
    };
  }
  if (packageManager === "bun") {
    return {
      command: "bun",
      args: ["add", "--dev", packageSpecifier],
      cwd: projectRoot,
    };
  }
  return {
    command: "pnpm",
    args: [
      "add",
      "--save-dev",
      ...(packageManagerNeedsWorkspaceFlag(projectRoot) ? ["-w"] : []),
      packageSpecifier,
    ],
    cwd: projectRoot,
  };
};

const execFileAsync = promisify(execFile);

const defaultInstallDependencyRunner = async (
  input: InstallReactDoctorDependencyRunnerInput,
): Promise<void> => {
  await execFileAsync(input.command, [...input.args], {
    cwd: input.cwd,
    env: { ...process.env, REACT_DOCTOR_INSTALL: "1" },
    shell: process.platform === "win32",
  });
};

// pnpm's supply-chain trust guard (`ERR_PNPM_TRUST_DOWNGRADE`) rejects a
// dependency whose newest version has weaker trust evidence than an
// earlier one. It reads as a compromise but is routinely tripped by
// pre-release deps; detect it so we can reassure instead of alarm.
const isSupplyChainTrustError = (error: unknown): boolean => {
  const candidate = error as {
    stderr?: unknown;
    stdout?: unknown;
    message?: unknown;
  } | null;
  const haystack = [candidate?.stderr, candidate?.stdout, candidate?.message]
    .map((part) => String(part ?? ""))
    .join("\n");
  return /ERR_PNPM_TRUST_DOWNGRADE|trust downgrade/i.test(haystack);
};

const formatInstallCommand = (input: InstallReactDoctorDependencyRunnerInput): string =>
  [input.command, ...input.args].join(" ");

const installReactDoctorDependency = async (
  options: InstallReactDoctorDependencyOptions,
): Promise<InstallReactDoctorDependencyResult> => {
  const packageJson = readPackageJson(options.projectRoot);
  if (!isRecord(packageJson)) {
    return {
      dependencyStatus: "skipped",
      dependencyReason: "missing-or-invalid-package-json",
    };
  }
  if (hasDoctorDependency(packageJson)) return { dependencyStatus: "existing" };
  if (packageJson.devDependencies !== undefined && !isRecord(packageJson.devDependencies)) {
    return {
      dependencyStatus: "skipped",
      dependencyReason: "invalid-dev-dependencies",
    };
  }

  const runnerInput = buildInstallCommand(options.projectRoot);
  try {
    await (options.runner ?? defaultInstallDependencyRunner)(runnerInput);
  } catch (error) {
    return {
      dependencyStatus: "skipped",
      dependencyReason: isSupplyChainTrustError(error)
        ? "trust-policy-blocked"
        : "install-command-failed",
      installCommand: formatInstallCommand(runnerInput),
    };
  }
  return { dependencyStatus: "created" };
};

const buildManualGitHookTarget = (hookPath: string, projectRoot: string): GitHookTarget => ({
  hookPath,
  runnerRoot: projectRoot,
  kind: GitHookKind.Git,
});

const formatGitHookInstallMessage = (
  hookResult: ReturnType<typeof installReactDoctorGitHook>,
): string => {
  if (CONFIG_ONLY_GIT_HOOK_KINDS.has(hookResult.kind)) {
    return `React Doctor pre-commit config ${hookResult.status} at ${hookResult.hookPath}. Run your hook manager's install command if hooks are not already installed.`;
  }
  return `React Doctor pre-commit hook ${hookResult.status} at ${hookResult.hookPath}.`;
};

const formatDependencyInstallMessage = (result: InstallReactDoctorDependencyResult): string => {
  if (result.dependencyStatus === "created") {
    return "Installed dev dependency: react-doctor.";
  }
  if (result.dependencyStatus === "existing") {
    return "React Doctor dependency already exists.";
  }
  if (result.dependencyReason === "invalid-dev-dependencies") {
    return "Skipped dev dependency install: devDependencies field is not an object.";
  }
  if (result.dependencyReason === "trust-policy-blocked") {
    return "Local install skipped by your package manager's supply-chain trust policy (safe to ignore for pre-release packages).";
  }
  if (result.dependencyReason === "install-command-failed") {
    return "Local install failed: your package manager rejected the command.";
  }
  return "Skipped dev dependency install: package.json missing or invalid.";
};

const buildDependencyFollowUp = (
  result: InstallReactDoctorDependencyResult,
): string | undefined => {
  if (
    result.dependencyReason !== "trust-policy-blocked" &&
    result.dependencyReason !== "install-command-failed"
  ) {
    return undefined;
  }
  const installCommand =
    result.installCommand ?? `npm install --save-dev ${DOCTOR_PACKAGE_NAME}@latest`;
  return `  React Doctor still works via \`npx react-doctor\`. To install locally: ${installCommand}`;
};

export const installReactDoctorPackageSetup = async (
  projectRoot: string,
  dependencyRunner?: (input: InstallReactDoctorDependencyRunnerInput) => void | Promise<void>,
): Promise<InstallReactDoctorDependencyResult> => {
  installReactDoctorScriptStep(projectRoot);

  const dependencySpinner = spinner("Installing React Doctor package...").start();
  try {
    const dependencyResult = await installReactDoctorDependency({
      projectRoot,
      runner: dependencyRunner,
    });
    // Conversion + supply-chain-trust friction: did the local dev-dep install
    // land, already exist, or get skipped (and why)?
    recordCount(METRIC.installDependency, 1, {
      status: dependencyResult.dependencyStatus,
      reason: dependencyResult.dependencyReason ?? null,
      packageManager: detectPackageManager(projectRoot),
    });
    if (dependencyResult.dependencyStatus === "skipped") {
      // trust-policy-blocked is a soft skip: pnpm refused to add a pre-release
      // dep, but `npx react-doctor` still works. Use spinner.warn (⚠) so it
      // doesn't read like a crash; the dim follow-up tells the user how to
      // install manually when they're ready.
      const message = formatDependencyInstallMessage(dependencyResult);
      if (dependencyResult.dependencyReason === "trust-policy-blocked") {
        dependencySpinner.warn(message);
      } else {
        dependencySpinner.fail(message);
      }
      const followUp = buildDependencyFollowUp(dependencyResult);
      if (followUp !== undefined) logger.dim(followUp);
      return dependencyResult;
    }
    dependencySpinner.succeed(formatDependencyInstallMessage(dependencyResult));
    return dependencyResult;
  } catch (error) {
    dependencySpinner.fail("Failed to install React Doctor package.");
    throw error;
  }
};

interface InstallReactDoctorOptions {
  yes?: boolean;
  dryRun?: boolean;
  agentHooks?: boolean;
  // Overrides for tests; production callers leave these unset.
  sourceDir?: string;
  projectRoot?: string;
  detectedAgents?: SkillAgentType[];
  gitHookPath?: string | null;
  onPromptCancel?: () => void;
  installDependencyRunner?: (
    input: InstallReactDoctorDependencyRunnerInput,
  ) => void | Promise<void>;
  prompt?: typeof prompts;
}

export const getSkillSourceDirectory = (): string => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.join(distDirectory, "skills", SKILL_NAME);
};

const canInstallNativeAgentHooks = (agents: readonly SkillAgentType[]): boolean =>
  agents.some((agent) => agent === "claude-code" || agent === "cursor");

// Installs the primary skill (throws on failure — the install can't continue
// without it).
const installReactDoctorSkillStep = async (
  sourceDir: string,
  selectedAgents: SkillAgentType[],
  projectRoot: string,
): Promise<void> => {
  const installSpinner = spinner(`Installing ${SKILL_NAME} skill...`).start();
  try {
    const installResult = await installSkillsFromSource({
      source: sourceDir,
      agents: selectedAgents,
      cwd: projectRoot,
      mode: "copy",
    });

    if (installResult.skills.length === 0) {
      throw new Error(
        `Could not parse ${SKILL_MANIFEST_FILE} for ${SKILL_NAME} (missing or invalid frontmatter).`,
      );
    }
    if (installResult.failed.length > 0) {
      throw new Error(
        installResult.failed
          .map((failure) => `${getSkillAgentConfig(failure.agent).displayName}: ${failure.error}`)
          .join("\n"),
      );
    }

    installSpinner.succeed(
      `${SKILL_NAME} skill installed for ${selectedAgents
        .map((agent) => getSkillAgentConfig(agent).displayName)
        .join(", ")}.`,
    );
  } catch (error) {
    installSpinner.fail(`Failed to install ${SKILL_NAME} skill.`);
    throw error;
  }
};

const installReactDoctorGitHookStep = (gitHookTarget: GitHookTarget): void => {
  const hookSpinner = spinner("Installing React Doctor pre-commit hook...").start();
  try {
    const hookResult = installReactDoctorGitHook({
      hookPath: gitHookTarget.hookPath,
      projectRoot: gitHookTarget.runnerRoot,
      kind: gitHookTarget.kind,
      hooksPathConfig: gitHookTarget.hooksPathConfig,
    });
    hookSpinner.succeed(formatGitHookInstallMessage(hookResult));
    recordCount(METRIC.installGitHook, 1, { kind: hookResult.kind });
  } catch (error) {
    hookSpinner.fail("Failed to install React Doctor pre-commit hook.");
    throw error;
  }
};

const installReactDoctorAgentHooksStep = (
  projectRoot: string,
  selectedAgents: SkillAgentType[],
): void => {
  const hookSpinner = spinner("Installing React Doctor agent hooks...").start();
  try {
    const hookResult = installReactDoctorAgentHooks({
      projectRoot,
      agents: selectedAgents,
    });
    if (hookResult.installedAgents.length === 0) {
      hookSpinner.succeed("No supported native agent hook targets selected.");
    } else {
      hookSpinner.succeed(
        `React Doctor agent hooks installed for ${hookResult.installedAgents
          .map((agent) => getSkillAgentConfig(agent).displayName)
          .join(", ")}.`,
      );
      recordCount(METRIC.installAgentHooks, 1, {
        agentsCount: hookResult.installedAgents.length,
      });
    }
  } catch (error) {
    hookSpinner.fail("Failed to install React Doctor agent hooks.");
    throw error;
  }
};

// Writes the workflow into the working tree alongside the other files `install`
// lands (skill, package script, git hook) so the user reviews and commits it
// themselves. The PR-opening flow belongs to the post-scan handoff, not
// `install` — committing to a throwaway branch can lose the file if the push is
// rejected, leaving "yes" with nothing on disk.
const installReactDoctorWorkflowStep = async (projectRoot: string): Promise<boolean> => {
  const workflowSpinner = spinner("Adding GitHub Actions workflow...").start();
  // The template's push trigger scans the repo's actual default branch
  // (`master`, `develop`, …) instead of assuming `main`.
  const defaultBranch = await detectDefaultBranch(projectRoot);
  return reportWorkflowResult(
    workflowSpinner,
    installReactDoctorWorkflow(projectRoot, defaultBranch ?? undefined),
    projectRoot,
  );
};

// Bumps an existing workflow's floating `@v1` ref to `@v2` in place (mirroring
// the fresh-install write — the PR-opening upgrade variant is the post-scan
// handoff's job). Counts the same `install.workflow` activation as a fresh
// write so CI adoption stays comparable across both entry points.
const upgradeReactDoctorWorkflowStep = (projectRoot: string): boolean => {
  const workflowSpinner = spinner("Upgrading GitHub Actions workflow to v2...").start();
  const upgradeResult = upgradeReactDoctorWorkflowInPlace(projectRoot);
  if (upgradeResult.status === "failed") {
    workflowSpinner.fail("Couldn't update the GitHub Actions workflow.");
    return false;
  }
  if (upgradeResult.status === "not-needed") {
    workflowSpinner.succeed("GitHub Actions workflow already up to date.");
    return false;
  }
  workflowSpinner.succeed(
    `Upgraded the GitHub Actions workflow to v2 at ${path.relative(
      projectRoot,
      upgradeResult.workflowPath,
    )}.`,
  );
  recordCount(METRIC.installWorkflow, 1, { kind: "upgrade" });
  return true;
};

export const runInstallReactDoctor = async (
  options: InstallReactDoctorOptions = {},
): Promise<void> => {
  const requestedProjectRoot = options.projectRoot ?? process.cwd();
  const projectRoot = findNearestPackageDirectory(requestedProjectRoot) ?? requestedProjectRoot;
  const sourceDir = options.sourceDir ?? getSkillSourceDirectory();

  if (!fs.existsSync(path.join(sourceDir, SKILL_MANIFEST_FILE))) {
    logger.error(`Could not locate the ${SKILL_NAME} skill bundled with this package.`);
    process.exitCode = 1;
    return;
  }

  const detectedAgents = options.detectedAgents ?? (await detectAvailableAgents());
  if (detectedAgents.length === 0) {
    logger.error("No supported coding agents detected.");
    logger.dim(
      "  Looked for binaries on PATH (claude, codex, cursor, droid, gemini, copilot, opencode, pi)",
    );
    logger.dim("  and config dirs in $HOME (~/.claude, ~/.cursor, ~/.codex, ~/.gemini, ...).");
    process.exitCode = 1;
    return;
  }

  const skipPrompts = shouldSkipPrompts({ yes: options.yes });
  const gitHookTarget =
    options.gitHookPath === undefined
      ? detectGitHookTarget(projectRoot)
      : options.gitHookPath === null
        ? null
        : buildManualGitHookTarget(options.gitHookPath, projectRoot);
  const gitHookPath = gitHookTarget?.hookPath;
  const promptOptions =
    options.onPromptCancel === undefined ? {} : { onCancel: options.onPromptCancel };
  const prompt = options.prompt ?? prompts;

  const workflowTargetPath = getReactDoctorWorkflowPath(projectRoot);
  const existingWorkflow = readReactDoctorWorkflow(projectRoot);
  // A present-but-unreadable workflow also reads back as `null`; gate the "add"
  // offer on existence so we never pitch installing over a file that's already
  // there (and can't be upgraded either, since we couldn't read its contents).
  const canInstallWorkflow = !fs.existsSync(workflowTargetPath);
  // Mirror the post-scan handoff's `maybeOfferActionUpgrade`: the `@v1` → `@v2`
  // bump is a one-time, per-repo offer. Once it's been answered (accepted OR
  // declined), `hasHandledActionUpgrade` suppresses it here too — so `install`
  // never re-prompts, and `--yes` never silently re-applies an already-declined
  // bump.
  const canUpgradeWorkflow =
    existingWorkflow !== null &&
    workflowUsesV1Action(existingWorkflow.content) &&
    !hasHandledActionUpgrade(projectRoot);

  // Each install step runs right after the user commits to the install (past the
  // agent-selection guard below), so the writes land in one visible group and
  // cancelling agent selection never strands files on disk. `--yes`/non-interactive
  // runs have no prompts; `--dryRun` runs the prompts but defers every write to
  // the plan print below.

  // Step 1 — CI pitch leads the onboarding: scanning every pull request is the
  // highest-leverage setup step, so it's asked first using the same shared pitch
  // as the post-scan handoff. The decision is captured here, but the workflow
  // file isn't written until the install is confirmed (after the agent guard),
  // so a cancel can't leave an orphan workflow without the rest of the setup.
  // A fresh workflow is offered when none exists; an existing one still pinned
  // to the action's previous floating major (`@v1`) is offered the in-place
  // `@v2` bump instead. The two are mutually exclusive — only one can apply.
  // `--yes` opts in and a bare non-interactive run opts out.
  // The CI pitch is once-per-repo across `install` and the post-scan handoff, so
  // a prior answer from either surface suppresses the interactive question here —
  // mirroring how `canUpgradeWorkflow` respects `hasHandledActionUpgrade`. `--yes`
  // still opts in (an explicit "set everything up" overrides a past decline).
  const ciPromptOutcome =
    canInstallWorkflow && !options.yes && !skipPrompts && !hasHandledCiPrompt(projectRoot)
      ? await askAddToGitHubActions(prompt)
      : null;
  const shouldInstallWorkflow =
    canInstallWorkflow && (Boolean(options.yes) || ciPromptOutcome === "yes");
  const upgradePromptOutcome =
    canUpgradeWorkflow && !options.yes && !skipPrompts
      ? await askUpgradeActionVersion(prompt)
      : null;
  const shouldUpgradeWorkflow =
    canUpgradeWorkflow && (Boolean(options.yes) || upgradePromptOutcome === "yes");

  // The upgrade prompt's "No, thanks" promises "won't ask again for this repo",
  // so persist a decline immediately — mirroring the post-scan handoff, and so
  // the offer stays suppressed even if the rest of the install is cancelled
  // below. Dry runs preview without writing anything.
  if (upgradePromptOutcome === "no" && !options.dryRun) {
    recordActionUpgradeDecision(projectRoot, "declined");
  }

  // The CI pitch is once-per-repo: persist the answer (yes or no) the moment
  // it's given — mirroring the post-scan handoff — so neither surface re-pitches
  // it. Recording the accept here (not just relying on the workflow file) keeps
  // it answered even if the install is cancelled below or the workflow write
  // fails; the user can always re-run `install` to set CI up. A cancel records
  // nothing. Dry runs preview without writing.
  if ((ciPromptOutcome === "yes" || ciPromptOutcome === "no") && !options.dryRun) {
    recordCiPromptDecision(projectRoot, ciPromptOutcome === "yes" ? "accepted" : "declined");
  }

  // Step 2 — the agent skill + package setup (the core of `install`).
  const selectedAgents: SkillAgentType[] = skipPrompts
    ? detectedAgents
    : ((
        await prompt(
          {
            type: "multiselect",
            name: "agents",
            message: `Install the ${highlighter.info(`/${SKILL_NAME}`)} skill for:`,
            choices: detectedAgents.map((agent) => ({
              title: getSkillAgentConfig(agent).displayName,
              value: agent,
              selected: true,
            })),
            instructions: false,
            min: 1,
          },
          promptOptions,
        )
      ).agents ?? []);

  if (selectedAgents.length === 0) return;

  let dependencyResult: InstallReactDoctorDependencyResult | undefined;
  if (!options.dryRun) {
    await installReactDoctorSkillStep(sourceDir, selectedAgents, projectRoot);
    dependencyResult = await installReactDoctorPackageSetup(
      projectRoot,
      options.installDependencyRunner,
    );
  }

  // The CI decision from Step 1 lands here, after the core skill + package setup
  // has run — so a thrown skill/package install never strands an orphan workflow
  // on disk (the workflow write is the last write in the core install group).
  let didInstallWorkflow = false;
  if (!options.dryRun && (shouldInstallWorkflow || shouldUpgradeWorkflow)) {
    // Blank line between the skill group and the workflow install/upgrade.
    logger.break();
    if (shouldInstallWorkflow) {
      didInstallWorkflow = await installReactDoctorWorkflowStep(projectRoot);
    } else if (upgradeReactDoctorWorkflowStep(projectRoot)) {
      // Applied upgrade is terminal too — record it so the post-scan handoff
      // never re-offers the bump on the next scan.
      recordActionUpgradeDecision(projectRoot, "accepted");
    }
  }

  // Step 3 — optional setup (pre-commit hook, agent hooks).
  const setupActionChoices = [
    ...(gitHookPath === null || gitHookPath === undefined
      ? []
      : [
          {
            title: "Pre-commit hook",
            description: "Check staged changes before each commit",
            value: SETUP_OPTION_GIT_HOOK,
            selected: true,
          },
        ]),
    ...(canInstallNativeAgentHooks(selectedAgents)
      ? [
          {
            title: "Agent hooks",
            description: "Ask Claude Code or Cursor to scan after code edits",
            value: SETUP_OPTION_AGENT_HOOKS,
            selected: Boolean(options.agentHooks),
          },
        ]
      : []),
  ];
  const setupChoices =
    setupActionChoices.length === 0
      ? []
      : [
          {
            title: "Skip optional setup",
            description: "Install only the agent skill and package setup",
            value: SETUP_OPTION_SKIP,
            selected: false,
          },
          ...setupActionChoices,
        ];

  // Blank line between the skill group and the optional-setup group.
  if (setupChoices.length > 0 && !options.dryRun) logger.break();

  const selectedSetupOptions: string[] =
    skipPrompts || setupChoices.length === 0
      ? []
      : ((
          await prompt<"setupOptions">(
            {
              type: "multiselect",
              name: "setupOptions",
              message: "Select additional React Doctor setup:",
              choices: setupChoices,
              instructions: false,
            },
            promptOptions,
          )
        ).setupOptions ?? []);
  const selectedSetupActions = selectedSetupOptions.filter(
    (setupOption) => setupOption !== SETUP_OPTION_SKIP,
  );
  const didSkipOptionalSetup =
    selectedSetupActions.length === 0 && selectedSetupOptions.includes(SETUP_OPTION_SKIP);

  const shouldInstallGitHook =
    gitHookPath != null &&
    (Boolean(options.yes) ||
      (!didSkipOptionalSetup && selectedSetupActions.includes(SETUP_OPTION_GIT_HOOK)));

  const shouldInstallAgentHooks =
    Boolean(options.agentHooks) ||
    (!didSkipOptionalSetup && selectedSetupActions.includes(SETUP_OPTION_AGENT_HOOKS));

  if (!options.dryRun) {
    if (shouldInstallGitHook && gitHookTarget !== null && gitHookTarget !== undefined) {
      installReactDoctorGitHookStep(gitHookTarget);
    }
    if (shouldInstallAgentHooks) {
      installReactDoctorAgentHooksStep(projectRoot, selectedAgents);
    }
  }

  if (options.dryRun) {
    logger.log(`Dry run — would install ${SKILL_NAME} skill for:`);
    for (const agent of selectedAgents) {
      logger.dim(`  - ${getSkillAgentConfig(agent).displayName}`);
    }
    logger.dim(`  Source: ${sourceDir}`);
    logger.dim("  Package script: doctor (or react-doctor if doctor exists)");
    logger.dim("  Dev dependency: react-doctor");
    if (shouldInstallGitHook) {
      logger.dim(`  Git hook: ${gitHookPath}`);
    }
    if (shouldInstallAgentHooks) {
      logger.dim("  Agent hooks: Claude Code / Cursor when selected");
    }
    if (shouldInstallWorkflow) {
      logger.dim(`  GitHub Actions workflow: ${path.relative(projectRoot, workflowTargetPath)}`);
    }
    if (shouldUpgradeWorkflow) {
      logger.dim(
        `  Upgrade GitHub Actions workflow to v2: ${path.relative(
          projectRoot,
          workflowTargetPath,
        )}`,
      );
    }
    return;
  }

  // Activation summary for a real (non-dry-run) install: how many agents, which
  // optional integrations, and the dependency outcome. `install.agent` breaks
  // the agent set down so per-agent adoption is queryable.
  recordCount(METRIC.installCompleted, 1, {
    agentsCount: selectedAgents.length,
    gitHook: shouldInstallGitHook,
    agentHooks: shouldInstallAgentHooks,
    workflow: didInstallWorkflow,
    dependencyStatus: dependencyResult?.dependencyStatus ?? "skipped",
    packageManager: detectPackageManager(projectRoot),
  });
  for (const agent of selectedAgents) {
    recordCount(METRIC.installAgent, 1, { agent });
  }
};
