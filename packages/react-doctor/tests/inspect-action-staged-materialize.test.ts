import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import { cliLogger } from "../src/cli/utils/cli-logger.js";
import { handleUserError } from "../src/cli/utils/handle-error.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../src/cli/utils/get-staged-files.js";
import { inspect } from "../src/inspect.js";
import { buildTestProject } from "./regressions/_helpers.js";

vi.mock("../src/cli/utils/handle-error.js", () => ({
  buildErrorIssueUrl: vi.fn(() => ""),
  handleError: vi.fn(),
  handleUserError: vi.fn(),
}));

vi.mock("../src/inspect.js", () => {
  const inspect = vi.fn();
  return {
    inspect,
    createInvocationInspect: () => inspect,
  };
});

vi.mock("../src/cli/utils/get-staged-files.js", () => ({
  getStagedSourceFiles: vi.fn(),
  materializeStagedFiles: vi.fn(),
}));

const temporaryDirectories: string[] = [];

const createDirectory = (prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const buildInspectResult = (rootDirectory: string): InspectResult => ({
  diagnostics: [],
  score: null,
  skippedChecks: [],
  project: buildTestProject({ rootDirectory }),
  elapsedMilliseconds: 1,
});

const initializeRepository = (directory: string): void => {
  const runGit = (args: ReadonlyArray<string>): void => {
    execFileSync("git", [...args], { cwd: directory });
  };
  runGit(["init", "-q", "-b", "main"]);
  runGit(["config", "user.email", "test@example.com"]);
  runGit(["config", "user.name", "test"]);
  runGit(["config", "commit.gpgsign", "false"]);
  runGit(["add", "."]);
  runGit(["commit", "-q", "-m", "init"]);
};

const writeReactRepository = (directory: string): void => {
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), '{"dependencies":{"react":"19"}}\n');
  fs.writeFileSync(path.join(directory, "src/app.tsx"), "export const App = () => null;\n");
  initializeRepository(directory);
};

describe("inspectAction staged materialization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.exitCode = undefined;
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("warns without blocking the commit when no staged file could be read out of the index", async () => {
    const directory = createDirectory("rd-staged-materialize-empty-");
    writeReactRepository(directory);
    const warn = vi.spyOn(cliLogger, "warn").mockImplementation(() => {});
    vi.spyOn(cliLogger, "break").mockImplementation(() => {});
    vi.mocked(getStagedSourceFiles).mockResolvedValue(["src/app.tsx"]);
    vi.mocked(materializeStagedFiles).mockImplementation(
      async ({ stagedFiles, tempDirectory }) => ({
        tempDirectory,
        stagedFiles: [],
        unmaterializedFiles: [...stagedFiles],
        cleanup: () => fs.rmSync(tempDirectory, { recursive: true, force: true }),
      }),
    );

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(inspect).not.toHaveBeenCalled();
    expect(handleUserError).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not read any of the 1 staged file "),
    );
  });

  it("warns and keeps scanning when only some staged files could be read", async () => {
    const directory = createDirectory("rd-staged-materialize-partial-");
    writeReactRepository(directory);
    const warn = vi.spyOn(cliLogger, "warn").mockImplementation(() => {});
    vi.spyOn(cliLogger, "break").mockImplementation(() => {});
    vi.mocked(getStagedSourceFiles).mockResolvedValue(["src/app.tsx", "src/gone.tsx"]);
    vi.mocked(materializeStagedFiles).mockImplementation(async ({ tempDirectory }) => ({
      tempDirectory,
      stagedFiles: ["src/app.tsx"],
      unmaterializedFiles: ["src/gone.tsx"],
      cleanup: () => fs.rmSync(tempDirectory, { recursive: true, force: true }),
    }));
    vi.mocked(inspect).mockImplementation(async (scanDirectory) =>
      buildInspectResult(scanDirectory),
    );

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipped 1 of 2 staged files"));
  });

  it("materializes only the staged files the selected projects own", async () => {
    const directory = createDirectory("rd-staged-owned-only-");
    for (const packageName of ["app", "other"]) {
      const packageDirectory = path.join(directory, "packages", packageName);
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
      `${JSON.stringify({ projects: ["packages/app"], noScore: true })}\n`,
    );
    initializeRepository(directory);
    const warn = vi.spyOn(cliLogger, "warn").mockImplementation(() => {});
    vi.spyOn(cliLogger, "break").mockImplementation(() => {});
    vi.mocked(getStagedSourceFiles).mockResolvedValue([
      "packages/app/src/app.tsx",
      "packages/other/src/other.tsx",
    ]);
    vi.mocked(materializeStagedFiles).mockImplementation(
      async ({ stagedFiles, tempDirectory }) => ({
        tempDirectory,
        stagedFiles: [],
        unmaterializedFiles: [...stagedFiles],
        cleanup: () => fs.rmSync(tempDirectory, { recursive: true, force: true }),
      }),
    );

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    // `other` is staged but unselected, so it never reaches the snapshot —
    // `git show` costs a subprocess per file and nothing would read those bytes.
    const [materializeInput] = vi.mocked(materializeStagedFiles).mock.calls[0] ?? [];
    expect(materializeInput?.stagedFiles).toEqual(["packages/app/src/app.tsx"]);
    // And the failure count is out of the owned files, not the whole index.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not read any of the 1 staged file "),
    );
  });

  it("materializes package config when rootDir redirects the scan directory", async () => {
    const directory = createDirectory("rd-staged-root-dir-config-");
    const packageDirectory = path.join(directory, "packages", "app");
    fs.mkdirSync(path.join(packageDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      '{"name":"app","dependencies":{"react":"19"}}\n',
    );
    fs.writeFileSync(
      path.join(packageDirectory, "doctor.config.json"),
      `${JSON.stringify({ rootDir: "src" })}\n`,
    );
    fs.writeFileSync(
      path.join(packageDirectory, "src/app.tsx"),
      "export const App = () => null;\n",
    );
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"monorepo-root","private":true}\n',
    );
    fs.writeFileSync(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    fs.writeFileSync(
      path.join(directory, "doctor.config.json"),
      `${JSON.stringify({ projects: ["packages/app"], noScore: true })}\n`,
    );
    initializeRepository(directory);
    vi.mocked(getStagedSourceFiles).mockResolvedValue(["packages/app/src/app.tsx"]);
    vi.mocked(materializeStagedFiles).mockImplementation(
      async ({ stagedFiles, tempDirectory }) => ({
        tempDirectory,
        stagedFiles: [],
        unmaterializedFiles: [...stagedFiles],
        cleanup: () => fs.rmSync(tempDirectory, { recursive: true, force: true }),
      }),
    );

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    const [materializeInput] = vi.mocked(materializeStagedFiles).mock.calls[0] ?? [];
    expect(materializeInput?.configSubdirectories).toEqual(["packages/app/src", "packages/app"]);
  });

  it("skips a package whose staged files could not be snapshotted and scans its sibling", async () => {
    const directory = createDirectory("rd-staged-materialize-one-package-");
    for (const packageName of ["app", "other"]) {
      const packageDirectory = path.join(directory, "packages", packageName);
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
      `${JSON.stringify({ projects: ["packages/app", "packages/other"], noScore: true })}\n`,
    );
    initializeRepository(directory);
    const warn = vi.spyOn(cliLogger, "warn").mockImplementation(() => {});
    vi.spyOn(cliLogger, "break").mockImplementation(() => {});
    vi.mocked(getStagedSourceFiles).mockResolvedValue([
      "packages/app/src/app.tsx",
      "packages/other/src/other.tsx",
    ]);
    // Only `app` comes out of the index. `other` must be dropped, not scanned
    // against an empty tree — and not turned into a failed commit either, since
    // an unreadable blob is not something the committer can act on.
    vi.mocked(materializeStagedFiles).mockImplementation(async ({ tempDirectory }) => ({
      tempDirectory,
      stagedFiles: ["packages/app/src/app.tsx"],
      unmaterializedFiles: ["packages/other/src/other.tsx"],
      cleanup: () => fs.rmSync(tempDirectory, { recursive: true, force: true }),
    }));
    vi.mocked(inspect).mockImplementation(async (scanDirectory) =>
      buildInspectResult(scanDirectory),
    );

    await inspectAction(directory, { staged: true, lint: false, yes: true });

    expect(handleUserError).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    const [scanDirectory, options] = vi.mocked(inspect).mock.calls[0] ?? [];
    expect(path.basename(String(scanDirectory))).toBe("app");
    expect(options?.includePaths).toEqual(["src/app.tsx"]);
    // The drop is reported, so a partially-snapshotted run cannot read as clean.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipped 1 of 2 staged files"));
  });
});
