import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import { CliInputError } from "../src/cli/utils/cli-input-error.js";
import { handleUserError } from "../src/cli/utils/handle-error.js";
import { inspect } from "../src/inspect.js";

vi.mock("../src/cli/utils/handle-error.js", () => ({
  buildErrorIssueUrl: vi.fn(() => ""),
  handleError: vi.fn(),
  handleUserError: vi.fn(),
}));

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
  ),
}));

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

describe("inspectAction staged snapshot guard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.assign(console, originalConsoleMethods);
    process.exitCode = undefined;
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

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
