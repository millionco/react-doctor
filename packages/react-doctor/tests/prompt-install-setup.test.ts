import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
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
  const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-prompt-install-setup-"));
  const configRoot = path.join(root, "config");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  return {
    configRoot,
    projectRoot,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

const writePackageJson = (projectRoot: string, value: Record<string, unknown>): void => {
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
};

const readPackageJson = (projectRoot: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

const readSetupPromptConfig = (configRoot: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(getSetupPromptConfigPath({ cwd: configRoot }), "utf8"));

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
    fs.mkdirSync(appDirectory, { recursive: true });
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
    fs.mkdirSync(nestedDirectory, { recursive: true });
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
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.mkdirSync(adminDirectory, { recursive: true });
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
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.mkdirSync(adminDirectory, { recursive: true });
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

  it("migrates a legacy opt-out forward and preserves it when disabling another", () => {
    writePackageJson(fixture.projectRoot, { scripts: {} });
    const otherProjectKey = getSetupPromptProjectKey("/other/project");
    // Seed a pre-v2, legacy-shaped opt-out (`setupPrompt: false`) for a
    // different project; opening the store should migrate it forward to a
    // setup-hint event without losing the opt-out.
    fs.writeFileSync(
      getSetupPromptConfigPath({ cwd: fixture.configRoot }),
      `${JSON.stringify(
        {
          projects: { [otherProjectKey]: { rootDirectory: "/other/project", setupPrompt: false } },
        },
        null,
        2,
      )}\n`,
    );

    expect(disableSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);

    // Both repos stay disabled — the migrated legacy one and the newly recorded one.
    expect(hasDisabledSetupPrompt("/other/project", { cwd: fixture.configRoot })).toBe(true);
    expect(hasDisabledSetupPrompt(fixture.projectRoot, { cwd: fixture.configRoot })).toBe(true);

    const projectKey = getSetupPromptProjectKey(fixture.projectRoot);
    const projects = readSetupPromptConfig(fixture.configRoot).projects;
    expect(projects[otherProjectKey].rootDirectory).toBe("/other/project");
    expect(projects[otherProjectKey].events["setup-hint"].outcome).toBe("declined");
    expect(projects[projectKey].rootDirectory).toBe(path.resolve(fixture.projectRoot));
    expect(projects[projectKey].events["setup-hint"].outcome).toBe("declined");
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
    const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-prompt-install-setup-eperm-"));
    const blockerFile = path.join(root, "blocker");
    fs.writeFileSync(blockerFile, "not a directory");
    // A config `cwd` whose parent is a file makes conf's mkdir fail with
    // ENOTDIR — the same class of failure as EPERM/EROFS on a read-only or
    // locked-down filesystem (REACT-DOCTOR-E). It must degrade, not crash.
    const unwritableCwd = path.join(blockerFile, "config");

    try {
      expect(() => hasDisabledSetupPrompt("/some/project", { cwd: unwritableCwd })).not.toThrow();
      expect(hasDisabledSetupPrompt("/some/project", { cwd: unwritableCwd })).toBe(false);
      expect(disableSetupPrompt("/some/project", { cwd: unwritableCwd })).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
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
