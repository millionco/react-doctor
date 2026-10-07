import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import { CliInputError } from "../src/cli/utils/cli-input-error.js";
import { cliLogger } from "../src/cli/utils/cli-logger.js";
import { handleUserError } from "../src/cli/utils/handle-error.js";
import { inspect } from "../src/inspect.js";

const deadlineMockState = vi.hoisted(() => ({ shouldExpire: false }));

vi.mock("@react-doctor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-doctor/core")>();
  return {
    ...actual,
    remainingDeadlineBudgetMs: (deadlineEpochMs: number) =>
      deadlineMockState.shouldExpire ? 0 : actual.remainingDeadlineBudgetMs(deadlineEpochMs),
  };
});

vi.mock("../src/cli/utils/handle-error.js", () => ({
  buildErrorIssueUrl: vi.fn(() => ""),
  handleError: vi.fn(),
  handleUserError: vi.fn(),
}));

vi.mock("../src/inspect.js", () => {
  const inspect = vi.fn(
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
        nextjsVersion: null,
        nextjsMajorVersion: null,
        hasReactNativeWorkspace: false,
        expoVersion: null,
        shopifyFlashListVersion: null,
        shopifyFlashListMajorVersion: null,
        hasReanimated: false,
        isPreES2023Target: false,
        preactVersion: null,
        preactMajorVersion: null,
        sourceFileCount: 1,
      },
      elapsedMilliseconds: 1,
    }),
  );
  return {
    inspect,
    createInvocationInspect: () => inspect,
  };
});

const temporaryDirectories: string[] = [];

const originalConsoleMethods = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  trace: console.trace,
};

const createDirectory = (prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const runGit = (directory: string, args: ReadonlyArray<string>): void => {
  execFileSync("git", [...args], { cwd: directory });
};

const writeReactProject = (directory: string): void => {
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), '{"dependencies":{"react":"19"}}\n');
  fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"rules":{}}\n');
  fs.writeFileSync(path.join(directory, "src/app.tsx"), "export const App = () => null;\n");
};

const initializeRepository = (directory: string): void => {
  runGit(directory, ["init", "-q", "-b", "main"]);
  runGit(directory, ["config", "user.email", "test@example.com"]);
  runGit(directory, ["config", "user.name", "test"]);
  runGit(directory, ["config", "commit.gpgsign", "false"]);
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "init"]);
};

const getLastCliInputErrorMessage = (): string => {
  const [error] = vi.mocked(handleUserError).mock.calls.at(-1) ?? [];
  return error instanceof CliInputError ? error.message : "";
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Object.assign(console, originalConsoleMethods);
  deadlineMockState.shouldExpire = false;
  process.exitCode = undefined;
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("inspectAction staged snapshot guard", () => {
  it("rejects a staged scan when tracked configuration diverges from the index", async () => {
    const directory = createDirectory("rd-staged-guard-");
    writeReactProject(directory);
    initializeRepository(directory);
    fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"warnings":true}\n');

    await inspectAction(directory, { staged: true, lint: false });

    expect(inspect).not.toHaveBeenCalled();
    expect(handleUserError).toHaveBeenCalledTimes(1);
    expect(getLastCliInputErrorMessage()).toContain(
      "Cannot scan staged files while configuration differs between the index and worktree: doctor.config.json",
    );
  });

  it("rejects a staged scan outside a Git worktree", async () => {
    const directory = createDirectory("rd-staged-guard-no-git-");
    writeReactProject(directory);

    await inspectAction(directory, { staged: true, lint: false });

    expect(inspect).not.toHaveBeenCalled();
    expect(handleUserError).toHaveBeenCalledTimes(1);
    expect(getLastCliInputErrorMessage()).toContain(
      "Could not verify that staged configuration matches the worktree",
    );
  });

  it("checks divergence in the rootDir-redirected repository, not the requested one", async () => {
    const targetDirectory = createDirectory("rd-staged-guard-target-");
    writeReactProject(targetDirectory);
    initializeRepository(targetDirectory);
    fs.writeFileSync(
      path.join(targetDirectory, "src/app.tsx"),
      "export const App = () => <div />;\n",
    );
    runGit(targetDirectory, ["add", "src/app.tsx"]);
    fs.writeFileSync(path.join(targetDirectory, "doctor.config.json"), '{"warnings":true}\n');

    const requestedDirectory = createDirectory("rd-staged-guard-redirect-");
    fs.writeFileSync(
      path.join(requestedDirectory, "package.json"),
      '{"dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(
      path.join(requestedDirectory, "doctor.config.json"),
      `${JSON.stringify({ rootDir: targetDirectory })}\n`,
    );
    initializeRepository(requestedDirectory);

    await inspectAction(requestedDirectory, { staged: true, lint: false });

    expect(inspect).not.toHaveBeenCalled();
    expect(handleUserError).toHaveBeenCalledTimes(1);
    expect(getLastCliInputErrorMessage()).toContain(
      "Cannot scan staged files while configuration differs between the index and worktree: doctor.config.json",
    );
  });

  it("writes a staged-mode JSON error report when rejecting under --json", async () => {
    const directory = createDirectory("rd-staged-guard-json-");
    writeReactProject(directory);
    initializeRepository(directory);
    fs.writeFileSync(path.join(directory, "doctor.config.json"), '{"warnings":true}\n');
    const reportPath = path.join(directory, "report.json");

    await inspectAction(directory, { staged: true, json: true, jsonOut: reportPath, lint: false });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(report.mode).toBe("staged");
    expect(report.ok).toBe(false);
    expect(report.error.name).toBe("CliInputError");
  });
});

describe("inspectAction staged multi-project", () => {
  // The `vi.mock` factory already builds a full InspectResult keyed off the
  // directory it is handed. Tests that only need to observe the temp tree
  // delegate to it instead of restating all of ProjectInfo.
  const getDefaultInspect = () => {
    const runDefaultInspect = vi.mocked(inspect).getMockImplementation();
    if (runDefaultInspect === undefined) throw new Error("inspect mock has no implementation");
    return runDefaultInspect;
  };

  const writeMonorepoWithoutRootReact = (directory: string): string => {
    const appDirectory = path.join(directory, "packages/app");
    fs.mkdirSync(path.join(appDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["packages/app"], noScore: true })}\n`,
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => null;\n");
    return appDirectory;
  };

  it("reports staged projects that never start before the shared deadline", async () => {
    const directory = createDirectory("rd-staged-project-deadline-");
    const firstProjectDirectory = path.join(directory, "packages/first");
    const secondProjectDirectory = path.join(directory, "packages/second");
    for (const projectDirectory of [firstProjectDirectory, secondProjectDirectory]) {
      fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, "package.json"),
        '{"dependencies":{"react":"19"}}\n',
      );
      fs.writeFileSync(
        path.join(projectDirectory, "src/app.tsx"),
        "export const App = () => null;\n",
      );
    }
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["packages/first", "packages/second"], noScore: true })}\n`,
    );
    initializeRepository(directory);

    for (const projectDirectory of [firstProjectDirectory, secondProjectDirectory]) {
      fs.writeFileSync(
        path.join(projectDirectory, "src/app.tsx"),
        "export const App = () => <div />;\n",
      );
    }
    runGit(directory, ["add", "packages/first/src/app.tsx", "packages/second/src/app.tsx"]);
    deadlineMockState.shouldExpire = true;
    const reportPath = path.join(directory, "report.json");

    await inspectAction(directory, {
      staged: true,
      json: true,
      jsonOut: reportPath,
      lint: false,
      maxDuration: "1",
      yes: true,
    });

    expect(inspect).not.toHaveBeenCalled();
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(report.skippedProjects).toEqual([
      { directory: firstProjectDirectory, reason: "max-duration" },
      { directory: secondProjectDirectory, reason: "max-duration" },
    ]);
  });

  it("materializes staged files under each selected package so React rules see package identity", async () => {
    const directory = createDirectory("rd-staged-projects-");
    const appDirectory = writeMonorepoWithoutRootReact(directory);
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    runGit(directory, ["add", "packages/app/src/app.tsx"]);

    // Capture the temp tree during inspect — cleanup runs in a finally after
    // the mock returns, so post-call reads of the temp dir are empty.
    const runDefaultInspect = getDefaultInspect();
    let materializedPackageJson = "";
    let materializedAppSourceExists = false;
    vi.mocked(inspect).mockImplementationOnce(async (tempDirectory, options) => {
      materializedPackageJson = fs.readFileSync(path.join(tempDirectory, "package.json"), "utf8");
      materializedAppSourceExists = fs.existsSync(path.join(tempDirectory, "src/app.tsx"));
      return runDefaultInspect(tempDirectory, options);
    });

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(inspect).mock.calls[0] ?? [];
    expect(options?.includePaths).toEqual(["src/app.tsx"]);
    expect(materializedPackageJson).toContain('"react"');
    expect(materializedPackageJson).not.toContain("monorepo-root");
    expect(materializedAppSourceExists).toBe(true);
  });

  it("falls back to the scan root when config projects is absent", async () => {
    const directory = createDirectory("rd-staged-root-fallback-");
    const appDirectory = path.join(directory, "packages/app");
    fs.mkdirSync(path.join(appDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => null;\n");
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    runGit(directory, ["add", "packages/app/src/app.tsx"]);

    const runDefaultInspect = getDefaultInspect();
    let materializedPackageJson = "";
    vi.mocked(inspect).mockImplementationOnce(async (tempDirectory, options) => {
      materializedPackageJson = fs.readFileSync(path.join(tempDirectory, "package.json"), "utf8");
      return runDefaultInspect(tempDirectory, options);
    });

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(inspect).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(inspect).mock.calls[0] ?? [];
    // Today's root scan: paths stay repo-relative under the monorepo root.
    expect(options?.includePaths).toEqual(["packages/app/src/app.tsx"]);
    expect(materializedPackageJson).toContain("monorepo-root");
    expect(materializedPackageJson).not.toContain('"react"');
  });

  it("lets --project override the config projects under --staged", async () => {
    const directory = createDirectory("rd-staged-project-flag-wins-");
    const appDirectory = path.join(directory, "packages/app");
    const otherDirectory = path.join(directory, "packages/other");
    fs.mkdirSync(path.join(appDirectory, "src"), { recursive: true });
    fs.mkdirSync(path.join(otherDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["packages/app"], noScore: true })}\n`,
    );
    for (const packageDirectory of [appDirectory, otherDirectory]) {
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        `{"name":"${path.basename(packageDirectory)}","dependencies":{"react":"19"}}\n`,
      );
      fs.writeFileSync(
        path.join(packageDirectory, "src/app.tsx"),
        "export const App = () => null;\n",
      );
    }
    initializeRepository(directory);

    for (const packageDirectory of [appDirectory, otherDirectory]) {
      fs.writeFileSync(
        path.join(packageDirectory, "src/app.tsx"),
        "export const App = () => <div />;\n",
      );
    }
    runGit(directory, ["add", "packages/app/src/app.tsx", "packages/other/src/app.tsx"]);

    await inspectAction(directory, {
      staged: true,
      project: "packages/other",
      lint: false,
      yes: true,
    });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    const [scanDirectory] = vi.mocked(inspect).mock.calls[0] ?? [];
    expect(scanDirectory).toContain(path.join("packages", "other"));
  });

  it("skips selected packages with no staged source files", async () => {
    const directory = createDirectory("rd-staged-skip-empty-");
    const appDirectory = path.join(directory, "packages/app");
    const otherDirectory = path.join(directory, "packages/other");
    fs.mkdirSync(path.join(appDirectory, "src"), { recursive: true });
    fs.mkdirSync(path.join(otherDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["packages/app", "packages/other"], noScore: true })}\n`,
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(
      path.join(otherDirectory, "package.json"),
      '{"name":"other","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => null;\n");
    fs.writeFileSync(
      path.join(otherDirectory, "src/other.tsx"),
      "export const Other = () => null;\n",
    );
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    runGit(directory, ["add", "packages/app/src/app.tsx"]);

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(inspect).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(inspect).mock.calls[0] ?? [];
    expect(options?.includePaths).toEqual(["src/app.tsx"]);
  });

  it("ignores an ancestor config's projects entry that resolves inside the target package", async () => {
    const directory = createDirectory("rd-staged-package-target-");
    const appDirectory = writeMonorepoWithoutRootReact(directory);
    // `"src"` does resolve from inside `packages/app`, so without the
    // requested-is-config-source guard the ancestor's entry would make
    // `packages/app/src` the scan root instead of the package itself. An entry
    // that fails to resolve cannot tell the guard apart from the fallback.
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["src"], noScore: true })}\n`,
    );
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    runGit(directory, ["add", "packages/app/src/app.tsx"]);
    const warn = vi.spyOn(cliLogger, "warn").mockImplementation(() => {});

    await inspectAction(appDirectory, { staged: true, lint: false, yes: true });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    const [scanDirectory, options] = vi.mocked(inspect).mock.calls[0] ?? [];
    expect(path.basename(String(scanDirectory))).not.toBe("src");
    expect(options?.includePaths).toEqual(["src/app.tsx"]);
    // The guard skipped the entry outright; it did not resolve it and fall back.
    expect(warn).not.toHaveBeenCalled();
  });

  const writeTwoPackageMonorepo = (
    directory: string,
    configProjects: ReadonlyArray<string>,
  ): { appDirectory: string; otherDirectory: string } => {
    const appDirectory = path.join(directory, "packages/app");
    const otherDirectory = path.join(directory, "packages/other");
    for (const [packageDirectory, packageName] of [
      [appDirectory, "app"],
      [otherDirectory, "other"],
    ] as const) {
      fs.mkdirSync(path.join(packageDirectory, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        `{"name":"${packageName}","dependencies":{"react":"19"}}\n`,
      );
      fs.writeFileSync(
        path.join(packageDirectory, `src/${packageName}.tsx`),
        "export const Component = () => null;\n",
      );
    }
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: [...configProjects], noScore: true })}\n`,
    );
    return { appDirectory, otherDirectory };
  };

  const getIncludePathsByScanDirectory = (): Record<string, ReadonlyArray<string> | undefined> => {
    // Pool order is nondeterministic, so key by the temp root each scan got
    // rather than by call index.
    const includePathsByDirectory: Record<string, ReadonlyArray<string> | undefined> = {};
    for (const [scanDirectory, options] of vi.mocked(inspect).mock.calls) {
      includePathsByDirectory[path.basename(scanDirectory)] = options?.includePaths;
    }
    return includePathsByDirectory;
  };

  it("scans every selected package that has staged files, each from its own package root", async () => {
    const directory = createDirectory("rd-staged-two-packages-");
    const { appDirectory, otherDirectory } = writeTwoPackageMonorepo(directory, [
      "packages/app",
      "packages/other",
    ]);
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    fs.writeFileSync(
      path.join(otherDirectory, "src/other.tsx"),
      "export const Other = () => <span />;\n",
    );
    runGit(directory, ["add", "packages/app/src/app.tsx", "packages/other/src/other.tsx"]);

    const runDefaultInspect = getDefaultInspect();
    const materializedPackageNames: string[] = [];
    // Two queued one-shot implementations rather than a persistent one: a
    // persistent `mockImplementation` would outlive `vi.clearAllMocks()` and
    // leak into the tests below. Both are identical, so pool order is moot.
    const captureMaterializedPackageName = async (
      tempDirectory: string,
      options: Parameters<typeof inspect>[1],
    ) => {
      materializedPackageNames.push(
        JSON.parse(fs.readFileSync(path.join(tempDirectory, "package.json"), "utf8")).name,
      );
      return runDefaultInspect(tempDirectory, options);
    };
    vi.mocked(inspect)
      .mockImplementationOnce(captureMaterializedPackageName)
      .mockImplementationOnce(captureMaterializedPackageName);

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(2);
    // Each scan is rooted at its own package, so React identity is per package
    // rather than the React-less monorepo root's.
    expect([...materializedPackageNames].sort()).toEqual(["app", "other"]);
    expect(getIncludePathsByScanDirectory()).toEqual({
      app: ["src/app.tsx"],
      other: ["src/other.tsx"],
    });
  });

  it("claims each staged file once when a package and its parent are both selected", async () => {
    const directory = createDirectory("rd-staged-nested-");
    const appDirectory = path.join(directory, "packages/app");
    const innerDirectory = path.join(appDirectory, "inner");
    fs.mkdirSync(path.join(innerDirectory, "src"), { recursive: true });
    fs.mkdirSync(path.join(appDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({
        // The same package three ways, plus a nested one: aliases must collapse
        // and the nested package must claim its own file.
        projects: ["packages/app", "./packages/app", "packages/app/inner"],
        noScore: true,
      })}\n`,
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(
      path.join(innerDirectory, "package.json"),
      '{"name":"inner","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => null;\n");
    fs.writeFileSync(
      path.join(innerDirectory, "src/inner.tsx"),
      "export const Inner = () => null;\n",
    );
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    fs.writeFileSync(
      path.join(innerDirectory, "src/inner.tsx"),
      "export const Inner = () => <div />;\n",
    );
    runGit(directory, ["add", "packages/app/src/app.tsx", "packages/app/inner/src/inner.tsx"]);

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(handleUserError).not.toHaveBeenCalled();
    // Two projects, not three: the alias collapsed. And `inner/src/inner.tsx`
    // belongs to `inner` alone, so it is never scanned twice.
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(getIncludePathsByScanDirectory()).toEqual({
      app: ["src/app.tsx"],
      inner: ["src/inner.tsx"],
    });
  });

  it("reports staged files outside the selected projects and still exits clean", async () => {
    const directory = createDirectory("rd-staged-unselected-");
    const { appDirectory, otherDirectory } = writeTwoPackageMonorepo(directory, ["packages/app"]);
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    fs.writeFileSync(
      path.join(otherDirectory, "src/other.tsx"),
      "export const Other = () => <span />;\n",
    );
    runGit(directory, ["add", "packages/app/src/app.tsx", "packages/other/src/other.tsx"]);

    const dimMessages: string[] = [];
    vi.spyOn(cliLogger, "dim").mockImplementation((message: string) => {
      dimMessages.push(message);
    });

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    // Out of scope, not missed — a plain scan would skip it too — so this stays
    // exit 0. It must not pass in silence, though.
    expect(handleUserError).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(dimMessages.join("\n")).toContain("1 more staged file outside the selected projects");
  });

  it("warns and scans the root when a config projects entry no longer resolves", async () => {
    const directory = createDirectory("rd-staged-stale-entry-");
    const appDirectory = path.join(directory, "packages/app");
    fs.mkdirSync(path.join(appDirectory, "src"), { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), '{"dependencies":{"react":"19"}}\n');
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["packages/renamed-away"], noScore: true })}\n`,
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => null;\n");
    initializeRepository(directory);

    fs.writeFileSync(path.join(appDirectory, "src/app.tsx"), "export const App = () => <div />;\n");
    runGit(directory, ["add", "packages/app/src/app.tsx"]);

    const warnMessages: string[] = [];
    vi.spyOn(cliLogger, "warn").mockImplementation((message: string) => {
      warnMessages.push(message);
    });

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    // A stale entry must not block every commit — `--staged` runs in a hook.
    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(warnMessages.join("\n")).toContain("packages/renamed-away");
    const [, options] = vi.mocked(inspect).mock.calls[0] ?? [];
    expect(options?.includePaths).toEqual(["packages/app/src/app.tsx"]);
  });
});
