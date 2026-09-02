import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { initGitRepo, setupReactProject, writeFile } from "../regressions/_helpers.js";

interface CliDiagnostic {
  readonly plugin: string;
  readonly rule: string;
}

interface CliReport {
  readonly diagnostics: ReadonlyArray<CliDiagnostic>;
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-staged-rule-parity-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const runJsonScan = (directory: string, argumentsList: ReadonlyArray<string>): CliReport => {
  const result = spawnSync(process.execPath, [builtCliPath, ".", ...argumentsList], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
  });

  expect(result.status).toBe(1);
  return JSON.parse(result.stdout);
};

const diagnosticRuleKeys = (report: CliReport): string[] =>
  report.diagnostics.map((diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`);

describe.skipIf(!hasBuiltCli)("staged rule parity", () => {
  it("reports an enabled no-clone-element finding in a newly staged file", () => {
    const projectDirectory = setupReactProject(temporaryRoot, "issue-1691", {
      files: {
        "doctor.config.json": `${JSON.stringify({
          noScore: true,
          rules: { "react-doctor/no-clone-element": "error" },
        })}\n`,
      },
    });
    initGitRepo(projectDirectory, { commit: true });

    writeFile(
      path.join(projectDirectory, "src/tab-pill.tsx"),
      `import { cloneElement, type ReactElement } from "react";

export const TabPill = ({ children }: { children: ReactElement }) =>
  cloneElement(children, { className: "tab" });
`,
    );
    spawnSync("git", ["add", "src/tab-pill.tsx"], { cwd: projectDirectory });

    const commonArguments = ["--json", "--no-score", "--no-supply-chain", "--no-telemetry"];
    const fullReport = runJsonScan(projectDirectory, ["--yes", ...commonArguments]);
    const stagedReport = runJsonScan(projectDirectory, ["--staged", ...commonArguments]);

    expect(diagnosticRuleKeys(fullReport)).toContain("react-doctor/no-clone-element");
    expect(diagnosticRuleKeys(stagedReport)).toContain("react-doctor/no-clone-element");
  }, 60_000);
});
