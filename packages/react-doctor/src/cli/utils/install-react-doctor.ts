import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSkillAgentConfig,
  installSkillsFromSource,
  SKILL_MANIFEST_FILE,
  type SkillAgentType,
} from "agent-install";
import { highlighter, SKILL_NAME } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { detectAvailableAgents } from "./detect-agents.js";
import {
  DOCTOR_PACKAGE_NAME,
  findNearestPackageDirectory,
  hasDoctorDependency,
  installDoctorScript,
} from "./install-doctor-script.js";
import { installReactDoctorAgentHooks } from "./install-agent-hooks.js";
import { isRecord, readPackageJson } from "./git-hook-shared.js";
import { GitHookKind, type GitHookTarget } from "./git-hook-types.js";
import { detectGitHookTarget, installReactDoctorGitHook } from "./install-git-hook.js";
import { prompts } from "./prompts.js";
import { shouldSkipPrompts } from "./should-skip-prompts.js";
import { spinner } from "./spinner.js";

const SETUP_OPTION_GIT_HOOK = "git-hook";
const SETUP_OPTION_AGENT_HOOKS = "agent-hooks";
const SETUP_OPTION_WORKFLOW = "workflow";
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
    | "install-command-failed";
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
    if (fileNames.some((fileName) => existsSync(path.join(currentDirectory, fileName)))) {
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
      lockfileDirectory !== null && existsSync(path.join(lockfileDirectory, lockfile.fileName)),
  );
  return matchedLockfile?.packageManager ?? "npm";
};

const packageManagerNeedsWorkspaceFlag = (projectRoot: string): boolean =>
  existsSync(path.join(projectRoot, "pnpm-workspace.yaml")) ||
  findNearestFileDirectory(projectRoot, ["pnpm-workspace.yaml"]) !== null;

const buildInstallCommand = (projectRoot: string): InstallReactDoctorDependencyRunnerInput => {
  const packageManager = detectPackageManager(projectRoot);
  const packageSpecifier = `${DOCTOR_PACKAGE_NAME}@latest`;
  if (packageManager === "npm") {
    return { command: "npm", args: ["install", "--save-dev", packageSpecifier], cwd: projectRoot };
  }
  if (packageManager === "yarn") {
    return { command: "yarn", args: ["add", "--dev", packageSpecifier], cwd: projectRoot };
  }
  if (packageManager === "bun") {
    return { command: "bun", args: ["add", "--dev", packageSpecifier], cwd: projectRoot };
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

const defaultInstallDependencyRunner = (input: InstallReactDoctorDependencyRunnerInput): void => {
  execFileSync(input.command, [...input.args], {
    cwd: input.cwd,
    stdio: "inherit",
    env: { ...process.env, REACT_DOCTOR_INSTALL: "1" },
    shell: process.platform === "win32",
  });
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
  } catch {
    return {
      dependencyStatus: "skipped",
      dependencyReason: "install-command-failed",
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

const formatDoctorScriptInstallMessage = (
  scriptResult: ReturnType<typeof installDoctorScript>,
): string => {
  const messages: string[] = [];
  const scriptName = scriptResult.scriptName ?? "doctor";
  if (scriptResult.scriptStatus === "created") {
    messages.push(`Added package script: ${scriptName}.`);
  } else if (scriptResult.scriptStatus === "existing") {
    messages.push(`Package script already exists: ${scriptName}.`);
  } else if (scriptResult.scriptReason === "script-names-taken") {
    messages.push("Skipped package script: doctor and react-doctor are already taken.");
  } else if (scriptResult.scriptReason === "doctor-script-taken") {
    messages.push("Skipped package script: doctor and react-doctor scripts already exist.");
  } else if (scriptResult.scriptReason === "invalid-scripts") {
    messages.push(`Skipped package script: scripts field is not an object.`);
  } else {
    messages.push("Skipped package script: package.json missing or invalid.");
  }

  return messages.join(" ");
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
  if (result.dependencyReason === "install-command-failed") {
    const installCommand =
      result.installCommand ?? `npm install --save-dev ${DOCTOR_PACKAGE_NAME}@latest`;
    return `Skipped dev dependency install: package manager command failed. Run manually: ${installCommand}`;
  }
  return "Skipped dev dependency install: package.json missing or invalid.";
};

const installReactDoctorPackageSetup = async (
  projectRoot: string,
  dependencyRunner?: (input: InstallReactDoctorDependencyRunnerInput) => void | Promise<void>,
): Promise<void> => {
  const scriptSpinner = spinner("Installing React Doctor package script...").start();
  try {
    const scriptResult = installDoctorScript({ projectRoot });
    scriptSpinner.succeed(formatDoctorScriptInstallMessage(scriptResult));
  } catch (error) {
    scriptSpinner.fail("Failed to install React Doctor package script.");
    throw error;
  }

  const dependencySpinner = spinner("Installing React Doctor package...").start();
  try {
    const dependencyResult = await installReactDoctorDependency({
      projectRoot,
      runner: dependencyRunner,
    });
    if (dependencyResult.dependencyStatus === "skipped") {
      dependencySpinner.fail(formatDependencyInstallMessage(dependencyResult));
      return;
    }
    dependencySpinner.succeed(formatDependencyInstallMessage(dependencyResult));
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

const getSkillSourceDirectory = (): string => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.join(distDirectory, "skills", SKILL_NAME);
};

const canInstallNativeAgentHooks = (agents: readonly SkillAgentType[]): boolean =>
  agents.some((agent) => agent === "claude-code" || agent === "cursor");

const buildWorkflowContent = (): string =>
  [
    "name: React Doctor",
    "",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize, reopened, ready_for_review]",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write",
    "  issues: write",
    "",
    "concurrency:",
    "  group: react-doctor-${{ github.event.pull_request.number || github.ref }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  react-doctor:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: millionco/react-doctor@main",
    "",
  ].join("\n");

export const runInstallReactDoctor = async (
  options: InstallReactDoctorOptions = {},
): Promise<void> => {
  const requestedProjectRoot = options.projectRoot ?? process.cwd();
  const projectRoot = findNearestPackageDirectory(requestedProjectRoot) ?? requestedProjectRoot;
  const sourceDir = options.sourceDir ?? getSkillSourceDirectory();

  if (!existsSync(path.join(sourceDir, SKILL_MANIFEST_FILE))) {
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

  const workflowsDirectory = path.join(projectRoot, ".github", "workflows");
  const workflowTargetPath = path.join(workflowsDirectory, "react-doctor.yml");
  const hasExistingWorkflows = existsSync(workflowsDirectory);
  const canInstallWorkflow = !existsSync(workflowTargetPath);
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
    ...(canInstallWorkflow
      ? [
          {
            title: "GitHub Actions workflow",
            description: "Scan pull requests in CI",
            value: SETUP_OPTION_WORKFLOW,
            selected: hasExistingWorkflows,
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
    gitHookPath !== null &&
    gitHookPath !== undefined &&
    (Boolean(options.yes) ||
      (!didSkipOptionalSetup && selectedSetupActions.includes(SETUP_OPTION_GIT_HOOK)));

  const shouldInstallAgentHooks =
    Boolean(options.agentHooks) ||
    (!didSkipOptionalSetup && selectedSetupActions.includes(SETUP_OPTION_AGENT_HOOKS));
  const shouldInstallWorkflow =
    !skipPrompts &&
    !didSkipOptionalSetup &&
    canInstallWorkflow &&
    selectedSetupActions.includes(SETUP_OPTION_WORKFLOW);

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
    return;
  }

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
      `${SKILL_NAME} skill installed for ${selectedAgents.map((agent) => getSkillAgentConfig(agent).displayName).join(", ")}.`,
    );
  } catch (error) {
    installSpinner.fail(`Failed to install ${SKILL_NAME} skill.`);
    throw error;
  }

  await installReactDoctorPackageSetup(projectRoot, options.installDependencyRunner);

  if (shouldInstallGitHook && gitHookTarget !== null && gitHookTarget !== undefined) {
    const hookSpinner = spinner("Installing React Doctor pre-commit hook...").start();
    try {
      const hookResult = installReactDoctorGitHook({
        hookPath: gitHookTarget.hookPath,
        projectRoot: gitHookTarget.runnerRoot,
        kind: gitHookTarget.kind,
        hooksPathConfig: gitHookTarget.hooksPathConfig,
      });
      hookSpinner.succeed(formatGitHookInstallMessage(hookResult));
    } catch (error) {
      hookSpinner.fail("Failed to install React Doctor pre-commit hook.");
      throw error;
    }
  }

  if (shouldInstallAgentHooks) {
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
          `React Doctor agent hooks installed for ${hookResult.installedAgents.map((agent) => getSkillAgentConfig(agent).displayName).join(", ")}.`,
        );
      }
    } catch (error) {
      hookSpinner.fail("Failed to install React Doctor agent hooks.");
      throw error;
    }
  }

  if (shouldInstallWorkflow) {
    if (!hasExistingWorkflows) {
      mkdirSync(workflowsDirectory, { recursive: true });
    }
    const workflowSpinner = spinner("Adding GitHub Actions workflow...").start();
    try {
      writeFileSync(workflowTargetPath, buildWorkflowContent());
      workflowSpinner.succeed(
        `GitHub Actions workflow added at ${path.relative(projectRoot, workflowTargetPath)}.`,
      );
    } catch (error) {
      workflowSpinner.fail("Failed to add GitHub Actions workflow.");
      throw error;
    }
  }
};
