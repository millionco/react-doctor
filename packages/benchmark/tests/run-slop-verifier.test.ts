import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runSlopVerifier } from "../src/run-slop-verifier.js";

const REACT_DOCTOR_BIN = path.resolve(
  import.meta.dirname,
  "..",
  "node_modules",
  ".bin",
  "react-doctor",
);

const createdDirectories: string[] = [];

const git = (cwd: string, args: string[]): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

// Create a git repo whose base commit holds `baseFiles`, then overlay
// `headFiles` as the agent's (uncommitted) working-tree change. Returns the
// root and the base commit sha.
const makeGitFixture = (
  baseFiles: Record<string, string>,
  headFiles: Record<string, string>,
): { rootDirectory: string; baseRef: string } => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "slopbench-e2e-"));
  createdDirectories.push(rootDirectory);
  const write = (files: Record<string, string>): void => {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(rootDirectory, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
    }
  };
  git(rootDirectory, ["init", "-q"]);
  git(rootDirectory, ["config", "user.email", "t@t.co"]);
  git(rootDirectory, ["config", "user.name", "t"]);
  write(baseFiles);
  git(rootDirectory, ["add", "-A"]);
  git(rootDirectory, ["commit", "-qm", "base"]);
  const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDirectory })
    .toString()
    .trim();
  write(headFiles);
  return { rootDirectory, baseRef };
};

const PACKAGE_JSON = JSON.stringify({
  name: "slopbench-e2e",
  version: "1.0.0",
  dependencies: { react: "^18.3.1" },
});

afterAll(() => {
  for (const directory of createdDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

describe("runSlopVerifier", () => {
  it("scores a clean feature near 100 and a sloppy one well below it", () => {
    const cleanFixture = makeGitFixture(
      { "package.json": PACKAGE_JSON, "src/base.ts": "export const a = 1;\n" },
      {
        "src/clean.tsx": [
          "import React from 'react';",
          "interface RowProps { label: string }",
          "export const Row = ({ label }: RowProps) => <li>{label}</li>;",
          "export const List = ({ labels }: { labels: string[] }) => (",
          "  <ul>{labels.map((label) => <Row key={label} label={label} />)}</ul>",
          ");",
          "",
        ].join("\n"),
      },
    );
    const clean = runSlopVerifier({
      rootDirectory: cleanFixture.rootDirectory,
      baseRef: cleanFixture.baseRef,
      reactDoctorBin: REACT_DOCTOR_BIN,
      functionalPass: true,
    });

    const sloppyFixture = makeGitFixture(
      { "package.json": PACKAGE_JSON, "src/base.ts": "export const a = 1;\n" },
      {
        "src/sloppy.tsx": [
          "import React from 'react';",
          "// @ts-ignore",
          "export function Card({ items }: { items: any[] }) {",
          "  const Row = () => <li>{(items[0] as string)!}</li>;",
          "  return <ul>{items.map((value, index) => <li key={index}>{value}</li>)}<Row /></ul>;",
          "}",
          "",
        ].join("\n"),
      },
    );
    const sloppy = runSlopVerifier({
      rootDirectory: sloppyFixture.rootDirectory,
      baseRef: sloppyFixture.baseRef,
      reactDoctorBin: REACT_DOCTOR_BIN,
      functionalPass: true,
    });

    expect(clean.scannerErrors).toEqual([]);
    expect(sloppy.scannerErrors).toEqual([]);
    expect(clean.slopScore).toBeGreaterThan(sloppy.slopScore);
    expect(sloppy.slopScore).toBeLessThan(95);
    // Findings come from more than one scanner on the sloppy diff.
    expect(new Set(sloppy.violations.map((violation) => violation.scanner)).size).toBeGreaterThan(1);
  });

  it("gates the reward on the functional outcome", () => {
    const fixture = makeGitFixture(
      { "package.json": PACKAGE_JSON, "src/base.ts": "export const a = 1;\n" },
      { "src/feature.ts": "export const value: any = 1;\n" },
    );
    const failed = runSlopVerifier({
      rootDirectory: fixture.rootDirectory,
      baseRef: fixture.baseRef,
      reactDoctorBin: REACT_DOCTOR_BIN,
      functionalPass: false,
    });
    expect(failed.reward).toBe(0);
    expect(failed.functionalPass).toBe(false);
    expect(failed.slopScore).toBeGreaterThan(0);
  });
});
