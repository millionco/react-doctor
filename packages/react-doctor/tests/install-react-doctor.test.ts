import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Answers, PromptObject } from "prompts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../src/cli/utils/is-ci-environment.js";
import { NON_INTERACTIVE_ENVIRONMENT_VARIABLES } from "../src/cli/utils/is-non-interactive-environment.js";
import { runInstallReactDoctor } from "../src/cli/utils/install-react-doctor.js";
import type { InstallReactDoctorDependencyRunnerInput } from "../src/cli/utils/install-react-doctor.js";
import { setSpinnerSilent } from "../src/cli/utils/spinner.js";
import { silenceConsoleForTest } from "./helpers/silence-console.js";

interface InstallReactDoctorFixture {
  projectRoot: string;
  sourceDir: string;
  cleanup: () => void;
}

const setupFixture = (): InstallReactDoctorFixture => {
  const root = mkdtempSync(path.join(tmpdir(), "react-doctor-install-"));
  const projectRoot = path.join(root, "project");
  const sourceDir = path.join(root, "source");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  return {
    projectRoot,
    sourceDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

const writeValidSkill = (sourceDir: string): void => {
  writeFileSync(
    path.join(sourceDir, "SKILL.md"),
    "---\nname: react-doctor\ndescription: Test skill for install fixtures\n---\n# react-doctor\n",
  );
};

const writePackageJson = (projectRoot: string, value: Record<string, unknown>): void => {
  writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
};

const readFixturePackageJson = (projectRoot: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

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
    answers[questionName] = questionName === "agents" ? ["cursor"] : options.setupOptions;
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
  let restoreConsole: () => void;

  beforeEach(() => {
    fixture = setupFixture();
    originalExitCode = process.exitCode;
    originalCi = process.env.CI;
    dependencyInstallCalls = [];
    process.exitCode = 0;
    restoreConsole = silenceConsoleForTest();
    setSpinnerSilent(true);
  });

  afterEach(() => {
    fixture.cleanup();
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
    expect(existsSync(path.join(fixture.projectRoot, ".agents"))).toBe(false);
    expect(readFixturePackageJson(fixture.projectRoot).scripts).toEqual({});
    expect(readFixturePackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
    expect(dependencyInstallCalls).toEqual([]);
  });

  it("throws when SKILL.md exists but has no parseable frontmatter (H1 silent-success regression guard)", async () => {
    // HACK: agent-install's discoverSkills returns an empty array for
    // SKILL.md without `name:` / `description:` frontmatter. Before the
    // fix, our wrapper only checked `failed.length > 0` and reported
    // success even though zero files were written.
    writeFileSync(
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
    writeFileSync(
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
    expect(existsSync(path.join(fixture.projectRoot, ".agents"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".claude"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".cursor"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".factory"))).toBe(false);
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

  it("detects the package manager from an ancestor package.json", async () => {
    writeValidSkill(fixture.sourceDir);
    writePackageJson(fixture.projectRoot, {
      packageManager: "pnpm@10.29.1",
      workspaces: ["apps/*"],
    });
    writeFileSync(path.join(fixture.projectRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    const appDirectory = path.join(fixture.projectRoot, "apps", "web");
    mkdirSync(appDirectory, { recursive: true });
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
    writeFileSync(path.join(fixture.sourceDir, "SKILL.md"), "# Invalid skill\n");
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
    mkdirSync(nestedDirectory, { recursive: true });

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
    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(path.join(nestedDirectory, ".agents"))).toBe(false);
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
    writeFileSync(path.join(fixture.projectRoot, "package.json"), "{ invalid json");

    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
      gitHookPath: null,
    });

    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(readFileSync(path.join(fixture.projectRoot, "package.json"), "utf8")).toBe(
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
    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
  });

  it("installs the skill into a vendor-specific directory for a non-universal agent", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallReactDoctorForTest({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["claude-code"],
    });
    expect(existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
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
      existsSync(path.join(fixture.projectRoot, ".factory/skills/react-doctor/SKILL.md")),
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

    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(readFileSync(hookPath, "utf8")).toContain("react-doctor --staged --fail-on warning");
    expect(existsSync(path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit"))).toBe(
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

    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(readFileSync(path.join(fixture.projectRoot, ".claude/settings.json"), "utf8")).toContain(
      "PostToolBatch",
    );
    expect(readFileSync(path.join(fixture.projectRoot, ".cursor/hooks.json"), "utf8")).toContain(
      "postToolUse",
    );
    expect(existsSync(path.join(fixture.projectRoot, ".codex/hooks.json"))).toBe(false);
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

    expect(promptQuestions).toHaveLength(2);
    expect(promptQuestions[1]).toEqual(
      expect.objectContaining({
        type: "multiselect",
        name: "setupOptions",
        message: "Select additional React Doctor setup:",
      }),
    );
    expect(promptQuestions[1]).toEqual(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ value: "skip" }),
          expect.objectContaining({ value: "git-hook" }),
          expect.objectContaining({ value: "agent-hooks" }),
          expect.objectContaining({ value: "workflow" }),
        ]),
      }),
    );
    expect(existsSync(hookPath)).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    const workflowContent = readFileSync(workflowPath, "utf8");
    expect(workflowContent).toContain("name: React Doctor");
    expect(workflowContent).toContain("pull-requests: write");
    expect(workflowContent).toContain("issues: write");
    expect(workflowContent).toContain("actions/checkout@v5");
    expect(workflowContent).toContain("millionco/react-doctor@v1");
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

    expect(existsSync(hookPath)).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(existsSync(workflowPath)).toBe(false);
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

    expect(existsSync(hookPath)).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(readFileSync(workflowPath, "utf8")).toContain("millionco/react-doctor@v1");
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

    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".claude/settings.json"))).toBe(false);
  });

  it("--yes installs Git and agent hooks in CI using real git detection", async () => {
    writeValidSkill(fixture.sourceDir);
    process.env.CI = "1";
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });

    await runInstallReactDoctorForTest({
      yes: true,
      agentHooks: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor", "claude-code"],
    });

    expect(readFileSync(path.join(fixture.projectRoot, ".git/hooks/pre-commit"), "utf8")).toContain(
      "react-doctor --staged --fail-on warning",
    );
    expect(existsSync(path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit"))).toBe(
      false,
    );
    expect(readFileSync(path.join(fixture.projectRoot, ".cursor/hooks.json"), "utf8")).toContain(
      "postToolUse",
    );
    expect(readFileSync(path.join(fixture.projectRoot, ".claude/settings.json"), "utf8")).toContain(
      "PostToolBatch",
    );
  });

  it("CI skips prompts without --yes but does not install the optional Git hook", async () => {
    writeValidSkill(fixture.sourceDir);
    process.env.CI = "1";
    execFileSync("git", ["init"], { cwd: fixture.projectRoot, stdio: "ignore" });

    await runInstallReactDoctorForTest({
      agentHooks: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
    });

    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
    expect(readFileSync(path.join(fixture.projectRoot, ".cursor/hooks.json"), "utf8")).toContain(
      "postToolUse",
    );
    expect(existsSync(path.join(fixture.projectRoot, ".git/hooks/pre-commit"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".react-doctor/hooks/pre-commit"))).toBe(
      false,
    );
  });
});
