import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runReactDoctor } from "../src/scanners/run-react-doctor.js";
import type { ScannerContext } from "../src/types/index.js";

const REACT_DOCTOR_BIN = path.resolve(
  import.meta.dirname,
  "..",
  "node_modules",
  ".bin",
  "react-doctor",
);

const createdDirectories: string[] = [];

const makeFixtureProject = (sourceByPath: Record<string, string>): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "slopbench-rd-"));
  createdDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify({ name: "slopbench-rd-fixture", version: "1.0.0", dependencies: { react: "^18.3.1" } }),
  );
  fs.writeFileSync(
    path.join(rootDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true, moduleResolution: "Bundler" } }),
  );
  for (const [relativePath, contents] of Object.entries(sourceByPath)) {
    const absolutePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  }
  return rootDirectory;
};

const makeContext = (rootDirectory: string, changedFiles: string[]): ScannerContext => ({
  rootDirectory,
  changedFiles,
  baseRef: "HEAD",
  addedLineCount: 20,
  reactDoctorBin: REACT_DOCTOR_BIN,
});

afterAll(() => {
  for (const directory of createdDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

describe("runReactDoctor", () => {
  it("maps a nested-component diagnostic to a react-correctness finding", () => {
    const rootDirectory = makeFixtureProject({
      "src/list.tsx": [
        "import React from 'react';",
        "export function List({ items }: { items: string[] }) {",
        "  const Row = () => <li>{items.length}</li>;",
        "  return <ul>{items.map((value, index) => <li key={index}>{value}</li>)}<Row /></ul>;",
        "}",
        "",
      ].join("\n"),
    });

    const result = runReactDoctor(makeContext(rootDirectory, ["src/list.tsx"]));

    expect(result.error).toBe(null);
    expect(result.doctorVersion).toBeTypeOf("string");
    const ruleIds = result.findings.map((finding) => finding.ruleId);
    expect(ruleIds.some((ruleId) => ruleId.includes("nested-component"))).toBe(true);
    const nested = result.findings.find((finding) => finding.ruleId.includes("nested-component"));
    expect(nested?.scanner).toBe("react-doctor");
    expect(nested?.dimension).toBe("react-correctness");
  });

  it("excludes diagnostics in files the agent did not change", () => {
    const rootDirectory = makeFixtureProject({
      "src/touched.tsx": "export const value: number = 1;\n",
      "src/untouched.tsx": [
        "import React from 'react';",
        "export function Widget({ items }: { items: string[] }) {",
        "  const Inner = () => <span>{items.length}</span>;",
        "  return <Inner />;",
        "}",
        "",
      ].join("\n"),
    });

    const result = runReactDoctor(makeContext(rootDirectory, ["src/touched.tsx"]));

    expect(result.error).toBe(null);
    expect(result.findings.every((finding) => finding.filePath === "src/touched.tsx")).toBe(true);
  });
});
