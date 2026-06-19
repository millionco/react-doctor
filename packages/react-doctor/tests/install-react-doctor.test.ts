import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Answers, PromptObject } from "prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as fs from "node:fs";

// Keeps the suite hermetic: the real detection spawns `gh` / `git` against
// the temp fixture, and a cold `gh.exe` on Windows CI has blown the 30s test
// timeout. Returning null exercises the same `main` fallback the fixtures
// (which have no git remote) would land on anyway.
vi.mock("../src/cli/utils/detect-default-branch.js", () => ({
  detectDefaultBranch: async () => null,
}));
import {
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../src/cli/utils/is-ci-environment.js";
import { NON_INTERACTIVE_ENVIRONMENT_VARIABLES } from "../src/cli/utils/is-non-interactive-environment.js";
import { runInstallReactDoctor } from "../src/cli/utils/install-react-doctor.js";
import type { InstallReactDoctorDependencyRunnerInput } from "../src/cli/utils/install-react-doctor.js";
import { recordActionUpgradeDecision } from "../src/cli/utils/action-upgrade-prompt.js";
import { CONFIG_DIR_ENV_VAR } from "../src/cli/utils/cli-state-store.js";
import { hasHandledCiPrompt, recordCiPromptDecision } from "../src/cli/utils/ci-prompt-decision.js";
import { setSpinnerSilent } from "../src/cli/utils/spinner.js";
import { silenceConsoleForTest } from "./helpers/silence-console.js";

interface InstallReactDoctorFixture {
  projectRoot: string;
  sourceDir: string;
  cleanup: () => void;
}

const setupFixture = (): InstallReactDoctorFixture => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-install-"));
  const projectRoot = path.join(root, "project");
  const sourceDir = path.join(root, "source");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  return {
    projectRoot,
    sourceDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

const writeValidSkill = (sourceDir: string): void => {
  fs.writeFileSync(
    path.join(sourceDir, "SKILL.md"),
    "---\nname: react-doctor\ndescription: Test skill for install fixtures\n---\n# react-doctor\n",
  );
};

const writePackageJson = (projectRoot: string, value: Record<string, unknown>): void => {
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
};

const writeExistingWorkflow = (projectRoot: string, actionRef: string): string => {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "react-doctor.yml");
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(
    workflowPath,
    [
      "name: React Doctor",
      "on:",
      "  pull_request:",
      "jobs:",
      "  react-doctor:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v5",
      `      - uses: ${actionRef}`,
      "",
    ].join("\n"),
  );
  return workflowPath;
};

const readFixturePackageJson = (projectRoot: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

let dependencyInstallCalls: InstallReactDoctorDependencyRunnerInput[] = [];

const installDependencyForTest: NonNullable<
  Parameters<typeof runInstallReactDoctor>[0]
>["installDependencyRunner"] = (input) => {
  dependencyInstallCalls.push(input);
  const packageJson = readFixturePackageJson(input.cwd);
  writePackageJson(input.cwd, {
    ...packageJson,
    devDependencies: {
      ...(typeof packageJson.devDependencies === "object" &&
      packageJson.devDependencies !== null &&
      !Array.isArray(packageJson.devDependencies)
        ? packageJson.devDependencies
        : {}),
      "react-doctor": "latest",
    },
  });
};

const runInstallReactDoctorForTest = (
  options: NonNullable<Parameters<typeof runInstallReactDoctor>[0]>,
) =>
  runInstallReactDoctor({
    installDependencyRunner: installDependencyForTest,
    ...options,
  });

interface RunInteractiveInstallReactDoctorForTestOptions {
  readonly sourceDir: string;
  readonly projectRoot: string;
  readonly gitHookPath: string;
  readonly setupOptions: readonly string[];
  readonly promptQuestions?: unknown[];
}

const runInteractiveInstallReactDoctorForTest = async (
  options: RunInteractiveInstallReactDoctorForTestOptions,
): Promise<void> => {
  const originalIsTty = process.stdin.isTTY;
  const savedEnvironmentValues = new Map<string, string | undefined>();
  const interactivePromptEnvironmentVariables = new Set([
    ...NON_INTERACTIVE_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  ]);
  const prompt: NonNullable<Parameters<typeof runInstallReactDoctor>[0]>["prompt"] = async <
    PromptName extends string = string,
  >(
    question: PromptObject<PromptName> | PromptObject<PromptName>[],
  ) => {
    options.promptQuestions?.push(question);
    const promptQuestion = Array.isArray(question) ? question[0] : question;
    const answers: Answers<PromptName> = Object.create(null);
    const questionName = promptQuestion?.name;
    if (typeof questionName !== "string") return answers;
    if (questionName === "agents") {
      answers[questionName] = ["cursor"];
    } else if (questionName === "ciChoice") {
      answers[questionName] = options.setupOptions.includes("workflow") ? "ci-yes" : "ci-no";
    } else if (questionName === "upgradeChoice") {
      answers[questionName] = options.setupOptions.includes("workflow-upgrade")
        ? "upgrade-yes"
        : "upgrade-no";
    } else {
      answers[questionName] = options.setupOptions;
    }
    return answers;
  };

  try {
    for (const environmentVariable of interactivePromptEnvironmentVariables) {
      savedEnvironmentValues.set(environmentVariable, process.env[environmentVariable]);
      delete process.env[environmentVariable];
    }
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });

    await runInstallReactDoctorForTest({
      sourceDir: options.sourceDir,
      projectRoot: options.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: options.gitHookPath,
      prompt,
    });
  } finally {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalIsTty,
    });
    for (const environmentVariable of interactivePromptEnvironmentVariables) {
      const savedEnvironmentValue = savedEnvironmentValues.get(environmentVariable);
      if (savedEnvironmentValue === undefined) {
        delete process.env[environmentVariable];
      } else {
        process.env[environmentVariable] = savedEnvironmentValue;
      }
    }
  }
};

describe("runInstallReactDoctor", () => {
  let fixture: InstallReactDoctorFixture;
  let originalExitCode: number | string | null | undefined;
  let originalCi: string | undefined;
  let originalConfigDir: string | undefined;
  let configDir: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    fixture = setupFixture();
    originalExitCode = process.exitCode;
    originalCi = process.env.CI;
    // Isolate the per-user CLI state (onboarding / prompt decisions) into a
    // throwaway dir so the interactive install flow — which records decisions
    // without threading a `cwd` — never reads or writes the real user config,
    // and parallel test runs can't pollute each other's persisted state.
    originalConfigDir = process.env[CONFIG_DIR_ENV_VAR];
    configDir = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-install-config-"));
    process.env[CONFIG_DIR_ENV_VAR] = configDir;
    dependencyInstallCalls = [];
    process.exitCode = 0;
    restoreConsole = silenceConsoleForTest();
    setSpinnerSilent(true);
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) {
      delete process.env[CONFIG_DIR_ENV_VAR];
    } else {
      process.env[CONFIG_DIR_ENV_VAR] = originalConfigDir;
    }
    process.exitCode = originalExitCode;
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
    restoreConsole();
    setSpinnerSilent(false);
  });

  it("exits with code 1 when the bundled SKILL.md is missing", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
    });
    expect(process.exitCode).toBe(1);
    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({});
    expect(readFixturePackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
    expect(dependencyInstallCalls).toEqual([]);
  });

  it("exits with code 1 when no agents are detected", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: [],
    });
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".agents"))).toBe(false);
    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({});
    expect(readFixturePackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
    expect(dependencyInstallCalls).toEqual([]);
  });

  it("throws when SKILL.md exists but has no parseable frontmatter (H1 silent-success regression guard)", async () => {
    // HACK: agent-install's discoverSkills returns an empty array for
    // SKILL.md without `name:` / `description:` frontmatter. Before the
    // fix, our wrapper only checked `failed.length > 0` and reported
    // success even though zero files were written.
    fs.writeFileSync(
      path.join(fixture.sourceDir, "SKILL.md"),
      "# Just a heading, no frontmatter\nNothing here.\n",
    );
    await expect(
      runInstallReactDoctorForTest({
        yes: true,
        sourceDir: fixture.sourceDir,
        projectRoot: fixture.projectRoot,
        detectedAgents: ["cursor"],
      }),
    ).rejects.toThrow(/Could not parse SKILL\.md/);
  });

  it("throws when frontmatter is missing the required `description` field (H1 regression guard)", async () => {
    fs.writeFileSync(
      path.join(fixture.sourceDir, "SKILL.md"),
      "---\nname: react-doctor\n---\n# react-doctor\n",
    );
    await expect(
      runInstallReactDoctorForTest({
        yes: true,
        sourceDir: fixture.sourceDir,
        projectRoot: fixture.projectRoot,
        detectedAgents: ["cursor"],
      }),
    ).rejects.toThrow(/Could not parse SKILL\.md/);
  });

  it("--dry-run writes nothing, even with valid SKILL.md and detected agents", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    await runInstallReactDoctorForTest({
      yes: true,
      dryRun: true,
      agentHooks: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor", "claude-code"],
    });
    expect(fs.existsSync(path.join(fixture.projectRoot, ".agents"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".cursor"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".factory"))).toBe(false);
    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({});
  });

  it("adds doctor package setup when package.json exists and setup is missing", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      scripts: {
        test: "vite-plus test",
      },
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      test: "vite-plus test",
      doctor: "npx react-doctor@latest",
    });
    expect(readFixturePackageJson(fixture.projectRoot).devDependencies).toEqual({
      "react-doctor": "latest",
    });
  });

  it("installs react-doctor with the detected package manager", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      packageManager: "pnpm@10.29.1",
      scripts: {},
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(dependencyInstallCalls).toEqual([
      {
        command: "pnpm",
        args: ["add", "--save-dev", "react-doctor@latest"],
        cwd: fixture.projectRoot,
      },
    ]);
  });

  it("does not fail setup when the package manager install command fails", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      scripts: {},
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
      installDependencyRunner: (input) => {
        dependencyInstallCalls.push(input);
        throw new Error("npm install failed");
      },
    });

    expect(process.exitCode).toBe(0);
    expect(dependencyInstallCalls).toEqual([
      {
        command: "npm",
        args: ["install", "--save-dev", "react-doctor@latest"],
        cwd: fixture.projectRoot,
      },
    ]);
    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "npx react-doctor@latest",
    });
    expect(readFixturePackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
  });

  it("does not fail setup when a supply-chain trust policy blocks the install", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
      installDependencyRunner: (input) => {
        dependencyInstallCalls.push(input);
        throw Object.assign(new Error("pnpm add failed"), {
          stderr: "ERR_PNPM_TRUST_DOWNGRADE  High-risk trust downgrade for effect@4.0.0-beta.70",
        });
      },
    });

    expect(process.exitCode).toBe(0);
    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "npx react-doctor@latest",
    });
    expect(readFixturePackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
  });

  it("detects the package manager from an ancestor package.json", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      packageManager: "pnpm@10.29.1",
      workspaces: ["apps/*"],
    });
    fs.writeFileSync(
      path.join(fixture.projectRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n",
    );
    const appDirectory = path.join(fixture.projectRoot, "apps", "web");
    fs.mkdirSync(appDirectory, { recursive: true });
    writePackageJson(appDirectory, {
      scripts: {},
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: appDirectory,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(dependencyInstallCalls).toEqual([
      {
        command: "pnpm",
        args: ["add", "--save-dev", "-w", "react-doctor@latest"],
        cwd: appDirectory,
      },
    ]);
  });

  it("does not mutate package setup when skill parsing fails", async () => {
    fs.writeFileSync(path.join(fixture.sourceDir, "SKILL.md"), "# Invalid skill\n");
    writePackageJson(fixture.projectRoot, { scripts: {} });

    await expect(
      runInstallReactDoctorForTest({
        yes: true,
        sourceDir: fixture.sourceDir,
        projectRoot: fixture.projectRoot,
        detectedAgents: ["cursor"],
      }),
    ).rejects.toThrow(/Could not parse SKILL\.md/);

    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({});
    expect(readFixturePackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
    expect(dependencyInstallCalls).toEqual([]);
  });

  it("installs package setup and skills at the nearest package root from a nested directory", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const nestedDirectory = path.join(fixture.projectRoot, "src", "components");
    fs.mkdirSync(nestedDirectory, { recursive: true });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: nestedDirectory,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "npx react-doctor@latest",
    });
    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(nestedDirectory, ".agents"))).toBe(false);
  });

  it("does not overwrite an existing doctor package script", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "pnpm react-doctor --verbose",
      },
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "pnpm react-doctor --verbose",
    });
    expect(readFixturePackageJson(fixture.projectRoot).devDependencies).toEqual({
      "react-doctor": "latest",
    });
  });

  it("adds a react-doctor package script when doctor is already taken", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "vitest --run",
      },
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "vitest --run",
      "react-doctor": "npx react-doctor@latest",
    });
    expect(readFixturePackageJson(fixture.projectRoot).devDependencies).toEqual({
      "react-doctor": "latest",
    });
  });

  it("does not overwrite an existing react-doctor dependency", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      devDependencies: {
        "react-doctor": "^1.2.3",
      },
      scripts: {},
    });

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "npx react-doctor@latest",
    });
    expect(readFixturePackageJson(fixture.projectRoot).devDependencies).toEqual({
      "react-doctor": "^1.2.3",
    });
  });

  it("does not crash setup when package.json is invalid", async () => {
    writeValidSkill(fixture.sourceDir);
    fs.writeFileSync(path.join(fixture.projectRoot, "package.json"), "{ invalid json");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(fs.readFileSync(path.join(fixture.projectRoot, "package.json"), "utf8")).toBe(
      "{ invalid json",
    );
  });

  it("installs the skill into the universal .agents/skills directory for a universal agent", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
    });
    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
  });

  it("installs the skill into a vendor-specific directory for a non-universal agent", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["claude-code"],
    });
    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md")),
    ).toBe(true);
  });

  it("installs the skill into .factory/skills for the droid agent (upstream agent-install@0.0.3)", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["droid"],
    });
    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".factory/skills/react-doctor/SKILL.md")),
    ).toBe(true);
  });

  it("--yes installs a non-blocking pre-commit hook when a git hook target is detected", async () => {
    writeValidSkill(fixture.sourceDir);
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: hookPath,
    });

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(fs.readFileSync(hookPath, "utf8")).toContain("react-doctor --staged --blocking warning");
    expect(fs.existsSync(path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit"))).toBe(
      false,
    );
  });

  it("--agent-hooks installs native hooks for selected supported agents", async () => {
    writeValidSkill(fixture.sourceDir);

    await runInstallReactDoctorForTest({
      yes: true,
      agentHooks: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor", "claude-code", "codex"],
      gitHookPath: null,
    });

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".claude/settings.json"), "utf8"),
    ).toContain("PostToolBatch");
    expect(fs.readFileSync(path.join(fixture.projectRoot, ".cursor/hooks.json"), "utf8")).toContain(
      "postToolUse",
    );
    expect(fs.existsSync(path.join(fixture.projectRoot, ".codex/hooks.json"))).toBe(false);
  });

  it("prompts once for optional setup and installs only selected options", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const promptQuestions: unknown[] = [];
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = path.join(fixture.projectRoot, ".github/workflows/react-doctor.yml");

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      setupOptions: ["workflow"],
      promptQuestions,
    });

    expect(promptQuestions).toHaveLength(3);
    // CI is asked first, as its own dedicated question (the shared pitch).
    expect(promptQuestions[0]).toEqual(
      expect.objectContaining({ type: "select", name: "ciChoice" }),
    );
    expect(promptQuestions[2]).toEqual(
      expect.objectContaining({
        type: "multiselect",
        name: "setupOptions",
        message: "Select additional React Doctor setup:",
      }),
    );
    expect(promptQuestions[2]).toEqual(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ value: "skip" }),
          expect.objectContaining({ value: "git-hook" }),
          expect.objectContaining({ value: "agent-hooks" }),
        ]),
      }),
    );
    expect(fs.existsSync(hookPath)).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    const workflowContent = fs.readFileSync(workflowPath, "utf8");
    expect(workflowContent).toContain("name: React Doctor");
    expect(workflowContent).toContain("pull-requests: write");
    expect(workflowContent).toContain("issues: write");
    expect(workflowContent).toContain("statuses: write");
    expect(workflowContent).toContain("actions/checkout@v5");
    expect(workflowContent).toContain("millionco/react-doctor@v2");
    expect(workflowContent).toContain("Advisory by default");
    expect(workflowContent).toContain("#   blocking: error");
    expect(workflowContent).not.toContain("\n        with:\n");
    expect(workflowContent).not.toContain("github-token");
    expect(workflowContent).not.toContain("diff: main");
  });

  it("skips optional setup when only the skip option is selected", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = path.join(fixture.projectRoot, ".github/workflows/react-doctor.yml");

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      setupOptions: ["skip"],
    });

    expect(fs.existsSync(hookPath)).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(fs.existsSync(workflowPath)).toBe(false);
  });

  it("honors selected setup actions when skip is selected with another option", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = path.join(fixture.projectRoot, ".github/workflows/react-doctor.yml");

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      setupOptions: ["skip", "workflow"],
    });

    expect(fs.existsSync(hookPath)).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(fs.readFileSync(workflowPath, "utf8")).toContain("millionco/react-doctor@v2");
  });

  it("--yes does not install native agent hooks unless --agent-hooks is set", async () => {
    writeValidSkill(fixture.sourceDir);

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor", "claude-code"],
      gitHookPath: null,
    });

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".claude/settings.json"))).toBe(false);
  });

  it("--yes installs Git and agent hooks in CI using real git detection", async () => {
    writeValidSkill(fixture.sourceDir);
    process.env.CI = "1";
    execFileSync("git", ["init"], {
      cwd: fixture.projectRoot,
      stdio: "ignore",
    });

    await runInstallReactDoctorForTest({
      yes: true,
      agentHooks: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor", "claude-code"],
    });

    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".git/hooks/pre-commit"), "utf8"),
    ).toContain("react-doctor --staged --blocking warning");
    expect(fs.existsSync(path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit"))).toBe(
      false,
    );
    expect(fs.readFileSync(path.join(fixture.projectRoot, ".cursor/hooks.json"), "utf8")).toContain(
      "postToolUse",
    );
    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".claude/settings.json"), "utf8"),
    ).toContain("PostToolBatch");
  });

  it("--yes upgrades an existing @v1 workflow to @v2 in place", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const workflowPath = writeExistingWorkflow(fixture.projectRoot, "millionco/react-doctor@v1");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    const workflowContent = fs.readFileSync(workflowPath, "utf8");
    expect(workflowContent).toContain("millionco/react-doctor@v2");
    expect(workflowContent).not.toContain("millionco/react-doctor@v1");
  });

  it("--yes leaves an exactly-pinned workflow untouched", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const workflowPath = writeExistingWorkflow(
      fixture.projectRoot,
      "millionco/react-doctor@v1.2.3",
    );
    const originalContent = fs.readFileSync(workflowPath, "utf8");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(fs.readFileSync(workflowPath, "utf8")).toBe(originalContent);
  });

  it("--yes leaves an already-@v2 workflow untouched", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const workflowPath = writeExistingWorkflow(fixture.projectRoot, "millionco/react-doctor@v2");
    const originalContent = fs.readFileSync(workflowPath, "utf8");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(fs.readFileSync(workflowPath, "utf8")).toBe(originalContent);
  });

  it("interactively upgrades an existing @v1 workflow when the offer is accepted", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = writeExistingWorkflow(fixture.projectRoot, "millionco/react-doctor@v1");
    const promptQuestions: unknown[] = [];

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      setupOptions: ["workflow-upgrade"],
      promptQuestions,
    });

    // The upgrade prompt replaces the "add" prompt when a workflow exists.
    expect(promptQuestions[0]).toEqual(
      expect.objectContaining({ type: "select", name: "upgradeChoice" }),
    );
    expect(fs.readFileSync(workflowPath, "utf8")).toContain("millionco/react-doctor@v2");
  });

  it("interactively keeps an existing @v1 workflow when the offer is declined", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = writeExistingWorkflow(fixture.projectRoot, "millionco/react-doctor@v1");

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      setupOptions: [],
    });

    expect(fs.readFileSync(workflowPath, "utf8")).toContain("millionco/react-doctor@v1");
    expect(fs.readFileSync(workflowPath, "utf8")).not.toContain("millionco/react-doctor@v2");
  });

  it("interactively skips the @v1 upgrade offer once the decision is already persisted", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = writeExistingWorkflow(fixture.projectRoot, "millionco/react-doctor@v1");
    recordActionUpgradeDecision(fixture.projectRoot, "declined");
    const promptQuestions: unknown[] = [];

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      // Would normally accept the bump — but the persisted decline suppresses
      // the offer entirely, so the prompt is never shown.
      setupOptions: ["workflow-upgrade"],
      promptQuestions,
    });

    expect(promptQuestions).not.toContainEqual(expect.objectContaining({ name: "upgradeChoice" }));
    expect(fs.readFileSync(workflowPath, "utf8")).toContain("millionco/react-doctor@v1");
    expect(fs.readFileSync(workflowPath, "utf8")).not.toContain("millionco/react-doctor@v2");
  });

  it("--yes does not re-apply an already-declined @v1 upgrade", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const workflowPath = writeExistingWorkflow(fixture.projectRoot, "millionco/react-doctor@v1");
    recordActionUpgradeDecision(fixture.projectRoot, "declined");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(fs.readFileSync(workflowPath, "utf8")).toContain("millionco/react-doctor@v1");
    expect(fs.readFileSync(workflowPath, "utf8")).not.toContain("millionco/react-doctor@v2");
  });

  it("interactively persists a declined CI offer so the scan handoff won't re-ask", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = path.join(fixture.projectRoot, ".github/workflows/react-doctor.yml");
    expect(hasHandledCiPrompt(fixture.projectRoot)).toBe(false);

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      // No "workflow" → the CI offer is declined (ci-no).
      setupOptions: [],
    });

    expect(fs.existsSync(workflowPath)).toBe(false);
    // The decline is persisted, so the once-per-repo pitch stays answered.
    expect(hasHandledCiPrompt(fixture.projectRoot)).toBe(true);
  });

  it("persists an accepted CI offer so the scan handoff won't re-ask", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = path.join(fixture.projectRoot, ".github/workflows/react-doctor.yml");
    expect(hasHandledCiPrompt(fixture.projectRoot)).toBe(false);

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      // "workflow" → the CI offer is accepted (ci-yes).
      setupOptions: ["workflow"],
    });

    expect(fs.existsSync(workflowPath)).toBe(true);
    // The accept is persisted at answer time, so an accept that never wrote the
    // workflow (early exit / failure) still won't re-pitch on the next scan.
    expect(hasHandledCiPrompt(fixture.projectRoot)).toBe(true);
  });

  it("interactively skips the CI offer once the decision is already persisted", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const hookPath = path.join(fixture.projectRoot, ".git/hooks/pre-commit");
    const workflowPath = path.join(fixture.projectRoot, ".github/workflows/react-doctor.yml");
    recordCiPromptDecision(fixture.projectRoot, "declined");
    const promptQuestions: unknown[] = [];

    await runInteractiveInstallReactDoctorForTest({
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      gitHookPath: hookPath,
      // Would normally add the workflow — but the persisted decline (e.g. from a
      // prior scan handoff) suppresses the CI question entirely.
      setupOptions: ["workflow"],
      promptQuestions,
    });

    expect(promptQuestions).not.toContainEqual(expect.objectContaining({ name: "ciChoice" }));
    expect(fs.existsSync(workflowPath)).toBe(false);
  });

  it("CI skips prompts without --yes but does not install the optional Git hook", async () => {
    writeValidSkill(fixture.sourceDir);
    process.env.CI = "1";
    execFileSync("git", ["init"], {
      cwd: fixture.projectRoot,
      stdio: "ignore",
    });

    await runInstallReactDoctorForTest({
      agentHooks: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
    });

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md")),
    ).toBe(true);
    expect(fs.readFileSync(path.join(fixture.projectRoot, ".cursor/hooks.json"), "utf8")).toContain(
      "postToolUse",
    );
    expect(fs.existsSync(path.join(fixture.projectRoot, ".git/hooks/pre-commit"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit"))).toBe(
      false,
    );
  });
});
