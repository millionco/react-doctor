import { spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { setupReactProject } from "../regressions/_helpers.js";
import { buildComplexityReport } from "../../src/cli/utils/complexity-report.js";
import { renderComplexityReport } from "../../src/cli/utils/render-complexity.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const stripAnsi = (input: string): string => input.replace(ANSI_ESCAPE_PATTERN, "");

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-complexity-cli-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const runCli = (
  args: string[],
  cwd: string,
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [builtCliPath, ...args], {
      cwd,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });

const setupComplexityProject = (caseId: string): string =>
  setupReactProject(tempRoot, caseId, {
    files: {
      "src/complexity.ts": `export function flatSwitch(value: number) {
  switch (value) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    default:
      return 4;
  }
}

export function nestedBranch(value: number) {
  if (value > 0) {
    if (value > 1) {
      return 2;
    }
  }
  return 0;
}

export function linear(value: number) {
  return value;
}
`,
    },
  });

describe.skipIf(!hasBuiltCli)("complexity command", () => {
  it("shows subcommand help for --help and -h", async () => {
    const projectDirectory = setupComplexityProject("complexity-help");

    const longHelpRun = await runCli(["complexity", "--help"], projectDirectory);
    expect(longHelpRun.exitCode).toBe(0);
    expect(longHelpRun.stderr).toBe("");
    expect(longHelpRun.stdout).toContain("Usage: react-doctor complexity");
    expect(longHelpRun.stdout).not.toContain("files analyzed");

    const shortHelpRun = await runCli(["complexity", "-h"], projectDirectory);
    expect(shortHelpRun.exitCode).toBe(0);
    expect(shortHelpRun.stderr).toBe("");
    expect(shortHelpRun.stdout).toContain("Usage: react-doctor complexity");
    expect(shortHelpRun.stdout).not.toContain("files analyzed");
  }, 60_000);

  it("respects top and sort settings in the rendered report", async () => {
    const projectDirectory = setupComplexityProject("subcommand-options");

    const cyclomaticReport = await buildComplexityReport({
      directory: projectDirectory,
      top: 2,
      minCyclomatic: 1,
      sortMetric: "cyclomatic",
    });
    const cyclomaticRenderedRows = stripAnsi(renderComplexityReport(cyclomaticReport))
      .split("\n")
      .filter((line) => line.startsWith("src/complexity.ts:"));
    expect(cyclomaticRenderedRows).toHaveLength(2);
    expect(cyclomaticRenderedRows[0]).toContain("flatSwitch");

    const cognitiveReport = await buildComplexityReport({
      directory: projectDirectory,
      top: 1,
      minCyclomatic: 1,
      sortMetric: "cognitive",
    });
    const cognitiveRenderedRows = stripAnsi(renderComplexityReport(cognitiveReport))
      .split("\n")
      .filter((line) => line.startsWith("src/complexity.ts:"));
    expect(cognitiveRenderedRows).toHaveLength(1);
    expect(cognitiveRenderedRows[0]).toContain("nestedBranch");

    const jsonRun = await runCli(["complexity", projectDirectory, "--json"], projectDirectory);
    expect(jsonRun.exitCode).toBe(0);
    expect(jsonRun.stderr).toBe("");
    const complexityJson = JSON.parse(jsonRun.stdout);
    expect(complexityJson).toMatchObject({
      mode: "full",
      directory: projectDirectory,
    });
  }, 60_000);

  it("keeps the default inspect command working with root options", async () => {
    const projectDirectory = setupComplexityProject("default-inspect");

    const jsonRun = await runCli([projectDirectory, "--json", "--no-score"], projectDirectory);
    expect(jsonRun.exitCode).toBe(0);
    expect(jsonRun.stderr).toBe("");
    const inspectJson = JSON.parse(jsonRun.stdout);
    expect(inspectJson).toMatchObject({
      schemaVersion: 1,
      mode: "full",
    });
  }, 60_000);
});
