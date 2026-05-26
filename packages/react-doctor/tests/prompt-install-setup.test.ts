import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { SETUP_PROMPT_DELAY_MS } from "../src/cli/utils/constants.js";
import {
  CI_ENVIRONMENT_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../src/cli/utils/is-ci-environment.js";
import {
  AGENT_INSTALL_HINT_LINES,
  disableSetupPrompt,
  getSetupPromptConfigPath,
  getSetupPromptProjectKey,
  hasDisabledSetupPrompt,
  printAgentInstallHint,
  promptInstallSetup,
  resolveInstallSetupProjectRoot,
  SETUP_PROMPT_CHOICE_NEVER,
  SETUP_PROMPT_CHOICE_NO,
  SETUP_PROMPT_CHOICE_YES,
  shouldPromptInstallSetup,
  shouldShowAgentInstallHint,
} from "../src/cli/utils/prompt-install-setup.js";

interface PromptInstallSetupFixture {
  readonly configRoot: string;
  readonly projectRoot: string;
  readonly cleanup: () => void;
}

const setupFixture = (): PromptInstallSetupFixture => {
  const root = mkdtempSync(path.join(tmpdir(), "react-doctor-prompt-install-setup-"));
  const configRoot = path.join(root, "config");
  const projectRoot = path.join(root, "project");
  mkdirSync(projectRoot, { recursive: true });
  return {
    configRoot,
    projectRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

const writePackageJson = (projectRoot: string, value: Record<string, unknown>): void => {
  writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
};

const readPackageJson = (projectRoot: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

const readSetupPromptConfig = (configRoot: string): Record<string, unknown> =>
  JSON.parse(readFileSync(getSetupPromptConfigPath({ cwd: configRoot }), "utf8"));

const ENVIRONMENT_VARIABLES = [
  "CI",
  ...CI_ENVIRONMENT_VARIABLES,
  ...CODING_AGENT_ENVIRONMENT_VARIABLES,
  ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
] as const;

describe("shouldPromptInstallSetup", () => {
  let fixture: PromptInstallSetupFixture;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const envVariable of ENVIRONMENT_VARIABLES) {
      savedEnv[envVariable] = process.env[envVariable];
      delete process.env[envVariable];
    }
    fixture = setupFixture();
  });

  afterEach(() => {
    for (const envVariable of ENVIRONMENT_VARIABLES) {
      const previousValue = savedEnv[envVariable];
      if (previousValue === undefined) {
        delete process.env[envVariable];
      } else {
        process.env[envVariable] = previousValue;
      }
    }
    fixture.cleanup();
  });

  it("prompts after a scored interactive scan when the doctor script is missing", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        test: "vite-plus test",
      },
    });

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(true);
  });

  it("resolves setup to the completed scan package instead of the monorepo root", () => {
    const appDirectory = path.join(fixture.projectRoot, "apps", "web");
    mkdirSync(appDirectory, { recursive: true });
    writePackageJson(fixture.projectRoot, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    writePackageJson(appDirectory, {
      name: "web",
      scripts: {},
    });

    expect(
      resolveInstallSetupProjectRoot({
        scanRoot: fixture.projectRoot,
        completedScanDirectories: [appDirectory],
      }),
    ).toBe(appDirectory);
  });

  it("resolves setup from a nested scan directory to the nearest package", () => {
    const appDirectory = path.join(fixture.projectRoot, "apps", "web");
    const nestedDirectory = path.join(appDirectory, "src", "components");
    mkdirSync(nestedDirectory, { recursive: true });
    writePackageJson(fixture.projectRoot, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    writePackageJson(appDirectory, {
      name: "web",
      scripts: {},
    });

    expect(
      resolveInstallSetupProjectRoot({
        scanRoot: fixture.projectRoot,
        completedScanDirectories: [nestedDirectory],
      }),
    ).toBe(appDirectory);
  });

  it("skips setup when a scan completed in multiple package roots", () => {
    const webDirectory = path.join(fixture.projectRoot, "apps", "web");
    const adminDirectory = path.join(fixture.projectRoot, "apps", "admin");
    mkdirSync(webDirectory, { recursive: true });
    mkdirSync(adminDirectory, { recursive: true });
    writePackageJson(fixture.projectRoot, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    writePackageJson(webDirectory, { name: "web" });
    writePackageJson(adminDirectory, { name: "admin" });

    expect(
      resolveInstallSetupProjectRoot({
        scanRoot: fixture.projectRoot,
        completedScanDirectories: [webDirectory, adminDirectory],
      }),
    ).toBeNull();
  });

  it("skips when the doctor script already exists", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "react-doctor",
      },
    });

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("prompts when doctor is taken by another command and react-doctor is missing", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "vitest --run",
      },
    });

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(true);
  });

  it("skips when the fallback react-doctor script already exists", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "vitest --run",
        "react-doctor": "react-doctor",
      },
    });

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("prompts when both script names exist but neither runs React Doctor", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "vitest --run",
        "react-doctor": "echo noop",
      },
    });

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(true);
  });

  it("skips when setup prompt has been disabled for this project", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    disableSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot });

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("skips quiet and non-interactive scan modes", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const baseOptions = {
      projectRoot: fixture.projectRoot,
      hasScoredScan: true,
      isJsonMode: false,
      isScoreOnly: false,
      isStaged: false,
      skipPrompts: false,
      store: { cwd: fixture.configRoot },
    };

    expect(shouldPromptInstallSetup({ ...baseOptions, isJsonMode: true })).toBe(false);
    expect(shouldPromptInstallSetup({ ...baseOptions, isScoreOnly: true })).toBe(false);
    expect(shouldPromptInstallSetup({ ...baseOptions, isStaged: true })).toBe(false);
    expect(shouldPromptInstallSetup({ ...baseOptions, skipPrompts: true })).toBe(false);
    expect(shouldPromptInstallSetup({ ...baseOptions, hasScoredScan: false })).toBe(false);
  });

  it("skips setup prompts in agent shells even when the caller did not pre-skip prompts", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    process.env.CURSOR_AGENT = "1";

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("skips setup prompts in CI even when the caller did not pre-skip prompts", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    process.env.CI = "true";

    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("waits after score output then installs when accepted", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    let waitedMilliseconds = 0;
    let selectMessage = "";
    let didInstall = false;

    await promptInstallSetup({
      projectRoot: fixture.projectRoot,
      hasScoredScan: true,
      issueCount: 2,
      isJsonMode: false,
      isScoreOnly: false,
      isStaged: false,
      skipPrompts: false,
      store: { cwd: fixture.configRoot },
      wait: async (milliseconds) => {
        waitedMilliseconds = milliseconds;
      },
      select: async (message) => {
        selectMessage = message;
        return SETUP_PROMPT_CHOICE_YES;
      },
      install: async () => {
        didInstall = true;
      },
    });

    expect(waitedMilliseconds).toBe(SETUP_PROMPT_DELAY_MS);
    expect(selectMessage).toBe("Set up React Doctor for this project?");
    expect(didInstall).toBe(true);
  });

  it("does not install when the user chooses no", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    let didInstall = false;

    await promptInstallSetup({
      projectRoot: fixture.projectRoot,
      hasScoredScan: true,
      issueCount: 1,
      isJsonMode: false,
      isScoreOnly: false,
      isStaged: false,
      skipPrompts: false,
      store: { cwd: fixture.configRoot },
      wait: async () => {},
      writeLine: () => {},
      select: async () => SETUP_PROMPT_CHOICE_NO,
      install: async () => {
        didInstall = true;
      },
    });

    expect(didInstall).toBe(false);
    expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(false);
  });

  it("treats prompt failures as a skipped optional setup prompt", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const warnings: string[] = [];

    await expect(
      promptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        issueCount: 1,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
        wait: async () => {},
        writeLine: () => {},
        select: async () => {
          throw new Error("prompt unavailable");
        },
        warn: (message) => {
          warnings.push(message);
        },
      }),
    ).resolves.toBeUndefined();

    expect(warnings).toEqual(["React Doctor setup prompt skipped: prompt unavailable"]);
  });

  it("treats setup failures as non-fatal after the scan", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const warnings: string[] = [];

    await expect(
      promptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        issueCount: 1,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
        wait: async () => {},
        writeLine: () => {},
        select: async () => SETUP_PROMPT_CHOICE_YES,
        install: async () => {
          throw new Error("install unavailable");
        },
        warn: (message) => {
          warnings.push(message);
        },
      }),
    ).resolves.toBeUndefined();

    expect(warnings).toEqual(["React Doctor setup prompt skipped: install unavailable"]);
  });

  it("preserves the scan exit code when setup returns with a different exit code", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const originalExitCode = process.exitCode;
    let didReceivePromptCancel = false;
    process.exitCode = undefined;

    try {
      await promptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        issueCount: 1,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
        wait: async () => {},
        writeLine: () => {},
        select: async () => SETUP_PROMPT_CHOICE_YES,
        install: async (installOptions) => {
          didReceivePromptCancel = installOptions.onPromptCancel !== undefined;
          installOptions.onPromptCancel?.();
          process.exitCode = 1;
        },
        warn: () => {},
      });

      expect(didReceivePromptCancel).toBe(true);
      expect(process.exitCode).toBeUndefined();
      expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(false);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("preserves a previous scan failure while suppressing future prompts after successful setup", async () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const originalExitCode = process.exitCode;
    process.exitCode = 1;

    try {
      await promptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        issueCount: 1,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
        wait: async () => {},
        writeLine: () => {},
        select: async () => SETUP_PROMPT_CHOICE_YES,
        install: async () => {},
        warn: () => {},
      });

      expect(process.exitCode).toBe(1);
      expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("does not prompt again after accepted setup completes without creating the doctor script", async () => {
    writePackageJson(fixture.projectRoot, { scripts: "invalid" });

    await promptInstallSetup({
      projectRoot: fixture.projectRoot,
      hasScoredScan: true,
      issueCount: 1,
      isJsonMode: false,
      isScoreOnly: false,
      isStaged: false,
      skipPrompts: false,
      store: { cwd: fixture.configRoot },
      wait: async () => {},
      writeLine: () => {},
      select: async () => SETUP_PROMPT_CHOICE_YES,
      install: async () => {},
      warn: () => {},
    });

    expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
    expect(
      shouldPromptInstallSetup({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        skipPrompts: false,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("persists never ask again in the global config store without installing", async () => {
    writePackageJson(fixture.projectRoot, {
      reactDoctor: {
        share: false,
      },
      scripts: {},
    });
    let didInstall = false;

    await promptInstallSetup({
      projectRoot: fixture.projectRoot,
      hasScoredScan: true,
      issueCount: 1,
      isJsonMode: false,
      isScoreOnly: false,
      isStaged: false,
      skipPrompts: false,
      store: { cwd: fixture.configRoot },
      wait: async () => {},
      writeLine: () => {},
      select: async () => SETUP_PROMPT_CHOICE_NEVER,
      install: async () => {
        didInstall = true;
      },
    });

    expect(didInstall).toBe(false);
    expect(readPackageJson(fixture.projectRoot).reactDoctor).toEqual({
      share: false,
    });
    const projectKey = getSetupPromptProjectKey(fixture.projectRoot);
    expect(readSetupPromptConfig(fixture.configRoot).projects).toEqual({
      [projectKey]: {
        rootDirectory: path.resolve(fixture.projectRoot),
        setupPrompt: false,
      },
    });
    expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
  });

  it("preserves existing global config values when disabling", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const otherProjectKey = getSetupPromptProjectKey("/other/project");
    writeFileSync(
      getSetupPromptConfigPath({ cwd: fixture.configRoot }),
      `${JSON.stringify(
        {
          projects: {
            [otherProjectKey]: {
              rootDirectory: "/other/project",
              setupPrompt: false,
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(disableSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
    const projectKey = getSetupPromptProjectKey(fixture.projectRoot);
    expect(readSetupPromptConfig(fixture.configRoot).projects).toEqual({
      [otherProjectKey]: {
        rootDirectory: "/other/project",
        setupPrompt: false,
      },
      [projectKey]: {
        rootDirectory: path.resolve(fixture.projectRoot),
        setupPrompt: false,
      },
    });
  });

  it("does not write the package.json when disabling directly", () => {
    writePackageJson(fixture.projectRoot, {
      reactDoctor: {
        share: false,
      },
      scripts: {},
    });

    expect(disableSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
    expect(readPackageJson(fixture.projectRoot).reactDoctor).toEqual({
      share: false,
    });
    expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
  });

  it("can disable setup prompt directly", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });

    expect(disableSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
    expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);
  });
});

describe("shouldShowAgentInstallHint", () => {
  let fixture: PromptInstallSetupFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("returns true in a coding agent environment when doctor script is missing", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });

    expect(
      shouldShowAgentInstallHint({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        isCodingAgent: true,
      }),
    ).toBe(true);
  });

  it("returns false when the doctor script already exists", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: { doctor: "react-doctor" },
    });

    expect(
      shouldShowAgentInstallHint({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        isCodingAgent: true,
      }),
    ).toBe(false);
  });

  it("returns false when not in a coding agent environment", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });

    expect(
      shouldShowAgentInstallHint({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        isCodingAgent: false,
      }),
    ).toBe(false);
  });

  it("returns false in JSON mode, score-only, staged, or without a scored scan", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const baseOptions = {
      projectRoot: fixture.projectRoot,
      hasScoredScan: true,
      isJsonMode: false,
      isScoreOnly: false,
      isStaged: false,
      isCodingAgent: true,
    };

    expect(shouldShowAgentInstallHint({ ...baseOptions, isJsonMode: true })).toBe(false);
    expect(shouldShowAgentInstallHint({ ...baseOptions, isScoreOnly: true })).toBe(false);
    expect(shouldShowAgentInstallHint({ ...baseOptions, isStaged: true })).toBe(false);
    expect(shouldShowAgentInstallHint({ ...baseOptions, hasScoredScan: false })).toBe(false);
  });

  it("returns false when setup prompt has been disabled for this project", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    disableSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot });

    expect(
      shouldShowAgentInstallHint({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        isCodingAgent: true,
        store: { cwd: fixture.configRoot },
      }),
    ).toBe(false);
  });

  it("returns false when the fallback react-doctor script exists", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: { doctor: "vitest", "react-doctor": "npx react-doctor@latest" },
    });

    expect(
      shouldShowAgentInstallHint({
        projectRoot: fixture.projectRoot,
        hasScoredScan: true,
        isJsonMode: false,
        isScoreOnly: false,
        isStaged: false,
        isCodingAgent: true,
      }),
    ).toBe(false);
  });
});

describe("printAgentInstallHint", () => {
  it("prints the install command and description", () => {
    const writtenLines: string[] = [];
    printAgentInstallHint((line = "") => {
      writtenLines.push(line);
    });
    const output = writtenLines.join("\n");

    expect(output).toContain("npx react-doctor install --yes");
    expect(output).toContain("not installed");
    expect(output).toContain("Ask the user");
  });

  it("AGENT_INSTALL_HINT_LINES contains the install command", () => {
    expect(AGENT_INSTALL_HINT_LINES.length).toBeGreaterThan(0);
    expect(
      AGENT_INSTALL_HINT_LINES.some((line) => line.includes("npx react-doctor install --yes")),
    ).toBe(true);
  });
});
