import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  AGENT_INSTALL_HINT_LINES,
  disableSetupPrompt,
  getSetupPromptConfigPath,
  getSetupPromptProjectKey,
  hasDisabledSetupPrompt,
  printAgentInstallHint,
  resolveInstallSetupProjectRoot,
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

describe("resolveInstallSetupProjectRoot", () => {
  let fixture: PromptInstallSetupFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
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
        scanDirectories: [appDirectory],
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
        scanDirectories: [nestedDirectory],
      }),
    ).toBe(appDirectory);
  });

  it("resolves setup to the scan root when a scan completed in multiple package roots", () => {
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
        scanDirectories: [webDirectory, adminDirectory],
      }),
    ).toBe(fixture.projectRoot);
  });

  it("skips setup for multiple package roots without a package at the scan root", () => {
    const scanRoot = path.join(fixture.projectRoot, "multi-root");
    const webDirectory = path.join(scanRoot, "web");
    const adminDirectory = path.join(scanRoot, "admin");
    mkdirSync(webDirectory, { recursive: true });
    mkdirSync(adminDirectory, { recursive: true });
    writePackageJson(webDirectory, { name: "web" });
    writePackageJson(adminDirectory, { name: "admin" });

    expect(
      resolveInstallSetupProjectRoot({
        scanRoot,
        scanDirectories: [webDirectory, adminDirectory],
      }),
    ).toBeNull();
  });
});

describe("disableSetupPrompt", () => {
  let fixture: PromptInstallSetupFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
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

  it("returns true in a coding agent environment after a completed scan without a score", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });

    expect(
      shouldShowAgentInstallHint({
        projectRoot: fixture.projectRoot,
        hasCompletedScan: true,
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

describe("setup-prompt store resilience", () => {
  it("degrades instead of crashing when the config directory cannot be created", () => {
    const root = mkdtempSync(path.join(tmpdir(), "react-doctor-prompt-install-setup-eperm-"));
    const blockerFile = path.join(root, "blocker");
    writeFileSync(blockerFile, "not a directory");
    // A config `cwd` whose parent is a file makes conf's mkdir fail with
    // ENOTDIR — the same class of failure as EPERM/EROFS on a read-only or
    // locked-down filesystem (REACT-DOCTOR-E). It must degrade, not crash.
    const unwritableCwd = path.join(blockerFile, "config");

    try {
      expect(() => hasDisabledSetupPrompt("/some/project", { cwd: unwritableCwd })).not.toThrow();
      expect(hasDisabledSetupPrompt("/some/project", { cwd: unwritableCwd })).toBe(false);
      expect(disableSetupPrompt("/some/project", { cwd: unwritableCwd })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
