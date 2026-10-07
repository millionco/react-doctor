import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { commitAll, initGitRepo, setupReactProject, writeFile } from "../regressions/_helpers.js";

interface CliBaselineReport {
  readonly mode: string;
  readonly baselineDegraded?: boolean;
  readonly baseline?: {
    readonly newCount: number;
    readonly fixedCount: number;
    readonly baseTotalCount: number;
  };
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-baseline-deleted-file-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const FOOTER_WITH_FINDINGS = `import { useEffect, useState } from "react";

export const Footer = ({ year }: { year: number }) => {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(String(year));
  }, [year]);
  return <footer>{label}</footer>;
};
`;

const runChangedScan = (directory: string, baseRef: string): CliBaselineReport => {
  const result = spawnSync(
    process.execPath,
    [
      builtCliPath,
      ".",
      "--scope",
      "changed",
      "--base",
      baseRef,
      "--json",
      "--no-score",
      "--no-supply-chain",
      "--no-telemetry",
      "--no-cache",
    ],
    { cwd: directory, encoding: "utf8", env: { ...process.env, CI: "1", FORCE_COLOR: "0" } },
  );
  return JSON.parse(result.stdout);
};

describe.skipIf(!hasBuiltCli)("baseline comparison with a deleted source file", () => {
  it("keeps baseline mode and counts the deleted file's findings as fixed", () => {
    const projectDirectory = setupReactProject(temporaryRoot, "issue-1768", {
      files: {
        "doctor.config.json": `${JSON.stringify({ noScore: true })}\n`,
        "src/components/footer.tsx": FOOTER_WITH_FINDINGS,
        "src/components/header.tsx": "export const Header = () => <header />;\n",
        "src/locales/en.json": `${JSON.stringify({ title: "Hello" })}\n`,
      },
    });
    initGitRepo(projectDirectory);
    const baseRef = commitAll(projectDirectory, "base");

    fs.rmSync(path.join(projectDirectory, "src/components/footer.tsx"));
    writeFile(
      path.join(projectDirectory, "src/components/header.tsx"),
      "export const Header = () => <header>Hello</header>;\n",
    );
    writeFile(
      path.join(projectDirectory, "src/locales/en.json"),
      `${JSON.stringify({ title: "Hello there" })}\n`,
    );
    commitAll(projectDirectory, "delete footer");

    const report = runChangedScan(projectDirectory, baseRef);

    expect(report.baselineDegraded).not.toBe(true);
    expect(report.mode).toBe("baseline");
    expect(report.baseline?.newCount).toBe(0);
    expect(report.baseline?.baseTotalCount).toBeGreaterThan(0);
    expect(report.baseline?.fixedCount).toBe(report.baseline?.baseTotalCount);
  }, 60_000);
});
