import { execFileSync } from "node:child_process";
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
    const cyclomaticRenderedText = stripAnsi(renderComplexityReport(cyclomaticReport));
    expect(cyclomaticRenderedText).toContain("flatSwitch");
    expect(cyclomaticRenderedText).toContain("nestedBranch");
    expect(cyclomaticRenderedText.indexOf("flatSwitch")).toBeLessThan(
      cyclomaticRenderedText.indexOf("nestedBranch"),
    );

    const cognitiveReport = await buildComplexityReport({
      directory: projectDirectory,
      top: 1,
      minCyclomatic: 1,
      sortMetric: "cognitive",
    });
    const cognitiveRenderedText = stripAnsi(renderComplexityReport(cognitiveReport));
    expect(cognitiveRenderedText).toContain("nestedBranch");
    expect(cognitiveRenderedText).not.toContain("flatSwitch");

    const jsonRun = await runCli(["complexity", projectDirectory, "--json"], projectDirectory);
    expect(jsonRun.exitCode).toBe(0);
    expect(jsonRun.stderr).toBe("");
    const complexityJson = JSON.parse(jsonRun.stdout);
    expect(complexityJson).toMatchObject({
      mode: "full",
      directory: projectDirectory,
    });
  }, 60_000);

  it("renders change complexity details in diff mode", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(tempRoot, "complexity-diff-"));
    try {
      execFileSync("git", ["init"], { cwd: projectDirectory, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: projectDirectory,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "Test User"], {
        cwd: projectDirectory,
        stdio: "ignore",
      });
      fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, "src/complexity.ts"),
        `export function formatOnly(value: number) { return value + 1; }

export function structural(value: number) {
  return value;
}

export function secondaryStructural(value: number) {
  return value;
}
`,
      );
      execFileSync("git", ["add", "."], { cwd: projectDirectory, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "base", "--quiet"], {
        cwd: projectDirectory,
        stdio: "ignore",
      });
      fs.writeFileSync(
        path.join(projectDirectory, "src/complexity.ts"),
        `export function formatOnly(value: number) {
  return value + 1;
}

export function structural(value: number) {
  if (value > 0) {
    return value;
  }
  return 0;
}

export function secondaryStructural(value: number) {
  if (value > 1) {
    return value;
  }
  return 0;
}
`,
      );
      execFileSync("git", ["add", "."], { cwd: projectDirectory, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "head", "--quiet"], {
        cwd: projectDirectory,
        stdio: "ignore",
      });

      const diffJsonRun = await runCli(
        ["complexity", projectDirectory, "--diff", "HEAD~1", "--json"],
        projectDirectory,
      );
      expect(diffJsonRun.exitCode).toBe(0);
      const diffJson = JSON.parse(diffJsonRun.stdout);
      expect(diffJson).toMatchObject({
        mode: "diff",
        diff: {
          computed: true,
        },
      });
      expect(diffJson.summary.complexityScore).toBeGreaterThanOrEqual(0);
      expect(diffJson.diff.normalizedChangeComplexityScore).toBeGreaterThan(0);
      expect(diffJson.diff.totalEssentialChange).toBeGreaterThan(0);
      expect(diffJson.diff.changeEntropy).toBeGreaterThan(0);
      expect(
        diffJson.functions.some((entry: { name: string }) => entry.name === "formatOnly"),
      ).toBe(true);

      const diffRenderRun = await runCli(
        ["complexity", projectDirectory, "--diff", "HEAD~1"],
        projectDirectory,
      );
      expect(diffRenderRun.exitCode).toBe(0);
      expect(diffRenderRun.stdout).toContain("React Doctor · Complexity vs HEAD~1");
      expect(diffRenderRun.stdout).toContain("bloat = raw lines ÷ real change");
      expect(diffRenderRun.stdout).toContain("⚠");
      expect(diffRenderRun.stdout).not.toContain("0f6dca72");
    } finally {
      fs.rmSync(projectDirectory, { recursive: true, force: true });
    }
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
