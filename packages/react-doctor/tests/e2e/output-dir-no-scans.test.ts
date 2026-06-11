/**
 * Regression test for the Bugbot finding "Output dir skipped when no scans":
 * with `--output-dir`, a diff-mode run where every project is skipped (no
 * changed files, so `inspect()` is never called) must still write the dump,
 * clear stale dump files from a previous run, and print the path line.
 */

import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { setupReactProject } from "../regressions/_helpers.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-output-dir-no-scans-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", ...args], {
    cwd,
    stdio: "ignore",
  });
};

const runCli = (
  args: string[],
  cwd: string,
): Promise<{ readonly stdout: string; readonly exitCode: number | null }> =>
  new Promise((resolve) => {
    const environment = { ...process.env, CI: "1", FORCE_COLOR: "0" };
    const child = spawn(process.execPath, [builtCliPath, ...args], {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("close", (exitCode) => resolve({ stdout, exitCode }));
  });

describe.skipIf(!hasBuiltCli)("--output-dir with no completed scans", () => {
  it("writes the dump and prints the path when diff mode skips every project", async () => {
    const projectDirectory = setupReactProject(tempRoot, "no-changes-fixture", {
      files: {
        "src/App.tsx": `export const App = () => null;\n`,
        "README.md": "docs\n",
      },
    });
    git(projectDirectory, "init", "-b", "main");
    git(projectDirectory, "add", ".");
    git(projectDirectory, "commit", "-m", "initial");
    // An uncommitted non-source change keeps diff mode active while leaving
    // zero changed source files — so the only project is skipped entirely.
    fs.appendFileSync(path.join(projectDirectory, "README.md"), "more docs\n");

    // A stale dump from an earlier run must be cleared even when no project
    // gets scanned this time. Seed both artifacts a real previous run leaves:
    // the rule file and the diagnostics.json that records it.
    const reportDirectory = path.join(projectDirectory, "doctor-report");
    fs.mkdirSync(reportDirectory, { recursive: true });
    fs.writeFileSync(path.join(reportDirectory, "react-doctor--old-rule.txt"), "stale");
    fs.writeFileSync(
      path.join(reportDirectory, "diagnostics.json"),
      JSON.stringify([{ plugin: "react-doctor", rule: "old-rule" }]),
    );

    const { stdout, exitCode } = await runCli(
      [".", "--scope", "changed", "--output-dir", "./doctor-report", "--no-score"],
      projectDirectory,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Full diagnostics written to");
    const dumpPath = path.join(reportDirectory, "diagnostics.json");
    expect(fs.existsSync(dumpPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(dumpPath, "utf8"))).toEqual([]);
    expect(fs.existsSync(path.join(reportDirectory, "react-doctor--old-rule.txt"))).toBe(false);
  }, 60_000);
});
