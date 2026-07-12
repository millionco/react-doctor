/**
 * E2E test for the --json-out flag: verify that JSON reports are written to
 * a file instead of stdout when the flag is provided.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { setupReactProject } from "../regressions/_helpers.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-json-out-"));

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
    const environment = { ...process.env, CI: "1", FORCE_COLOR: "0" };
    const child = spawn(process.execPath, [builtCliPath, ...args], {
      cwd,
      env: environment,
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

describe.skipIf(!hasBuiltCli)("--json-out flag", () => {
  it("writes JSON report to file instead of stdout", async () => {
    const projectDirectory = setupReactProject(tempRoot, "json-out-basic", {
      files: {
        "src/App.tsx": `export const App = () => null;\n`,
      },
    });

    const outputFile = path.join(projectDirectory, "report.json");
    const { stdout, stderr, exitCode } = await runCli(
      [".", "--json", "--json-out", "./report.json", "--no-score"],
      projectDirectory,
    );

    if (exitCode !== 0) {
      console.error("STDERR:", stderr);
      console.error("STDOUT:", stdout);
    }
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('"ok"');
    expect(fs.existsSync(outputFile)).toBe(true);
    const reportContent = fs.readFileSync(outputFile, "utf8");
    const report = JSON.parse(reportContent);
    expect(report.ok).toBeDefined();
    expect(report.schemaVersion).toBe(3);
  }, 60_000);
});
