import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import { inspect } from "../src/inspect.js";

const mockState = vi.hoisted(() => ({
  rootDirectory: "",
  projectDirectories: [] as string[],
}));

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

vi.mock("@react-doctor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-doctor/core")>();
  return {
    ...actual,
    resolveScanTarget: vi.fn(() => ({
      resolvedDirectory: mockState.rootDirectory,
      requestedDirectory: mockState.rootDirectory,
      userConfig: null,
      configSourceDirectory: null,
      didRedirectViaRootDir: false,
    })),
    getDiffInfo: vi.fn(async () => ({
      currentBranch: "feature",
      baseBranch: "main",
      changedFiles: ["apps/web/src/App.tsx"],
      isCurrentChanges: false,
    })),
    filterDiagnosticsForSurface: vi.fn((diagnostics) => diagnostics),
  };
});

vi.mock("../src/inspect.js", () => ({
  inspect: vi.fn(
    async (directory: string): Promise<InspectResult> => ({
      diagnostics: [],
      score: null,
      skippedChecks: [],
      project: {
        rootDirectory: directory,
        projectName: path.basename(directory),
        reactVersion: "^19.0.0",
        reactMajorVersion: 19,
        tailwindVersion: null,
        zodVersion: null,
        zodMajorVersion: null,
        framework: "unknown",
        hasTypeScript: true,
        hasReactCompiler: false,
        hasTanStackQuery: false,
        hasReactNativeWorkspace: false,
        hasReanimated: false,
        preactVersion: null,
        preactMajorVersion: null,
        sourceFileCount: 1,
      },
      elapsedMilliseconds: 1,
    }),
  ),
}));

vi.mock("../src/cli/utils/select-projects.js", () => ({
  selectProjects: vi.fn(async () => mockState.projectDirectories),
}));

vi.mock("../src/cli/utils/should-skip-prompts.js", () => ({
  shouldSkipPrompts: vi.fn(() => false),
}));

vi.mock("../src/cli/utils/render-multi-project-summary.js", async () => {
  const Effect = await import("effect/Effect");
  return {
    printMultiProjectSummary: vi.fn(() => Effect.void),
  };
});

vi.mock("../src/cli/utils/prompt-install-setup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/utils/prompt-install-setup.js")>();
  return {
    ...actual,
    shouldShowAgentInstallHint: vi.fn(() => false),
  };
});

const writePackageJson = (directory: string, value: Record<string, unknown>): void => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
};

describe("inspectAction setup prompt", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    mockState.rootDirectory = "";
    mockState.projectDirectories = [];
    for (const tempDirectory of tempDirectories.splice(0)) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("resolves setup from selected projects, not only completed diff scans", async () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-inspect-action-"));
    tempDirectories.push(rootDirectory);
    const webDirectory = path.join(rootDirectory, "apps", "web");
    const adminDirectory = path.join(rootDirectory, "apps", "admin");
    writePackageJson(rootDirectory, {
      name: "monorepo",
      workspaces: ["apps/*"],
      scripts: {},
    });
    writePackageJson(webDirectory, { name: "web", scripts: {} });
    writePackageJson(adminDirectory, { name: "admin", scripts: {} });

    mockState.rootDirectory = rootDirectory;
    mockState.projectDirectories = [webDirectory, adminDirectory];

    await inspectAction(rootDirectory, { diff: true, lint: false });

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(
      webDirectory,
      expect.objectContaining({
        includePaths: ["src/App.tsx"],
      }),
    );
  });

  it("scans project-relative paths from an explicit changed-files file", async () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-changed-files-"));
    tempDirectories.push(rootDirectory);
    const webDirectory = path.join(rootDirectory, "apps", "web");
    const adminDirectory = path.join(rootDirectory, "apps", "admin");
    writePackageJson(rootDirectory, {
      name: "monorepo",
      workspaces: ["apps/*"],
      scripts: {},
    });
    writePackageJson(webDirectory, { name: "web", scripts: {} });
    writePackageJson(adminDirectory, { name: "admin", scripts: {} });
    const changedFilesPath = path.join(rootDirectory, "changed-files.txt");
    fs.writeFileSync(
      changedFilesPath,
      ["apps/web/src/App.tsx", "apps/admin/src/Dashboard.tsx", "README.md", "../outside.tsx"].join(
        "\n",
      ),
    );

    mockState.rootDirectory = rootDirectory;
    mockState.projectDirectories = [webDirectory, adminDirectory];

    await inspectAction(rootDirectory, { changedFilesFrom: changedFilesPath, lint: false });

    expect(inspect).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenNthCalledWith(
      1,
      webDirectory,
      expect.objectContaining({
        includePaths: ["src/App.tsx"],
      }),
    );
    expect(inspect).toHaveBeenNthCalledWith(
      2,
      adminDirectory,
      expect.objectContaining({
        includePaths: ["src/Dashboard.tsx"],
      }),
    );
  });
});
