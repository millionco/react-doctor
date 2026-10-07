import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { commitAll, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const CLI = path.resolve(import.meta.dirname, "../../bin/react-doctor.js");
const EFFECT = [
  'import { useEffect } from "react";',
  "export const App = ({ value, other }) => {",
  "  useEffect(() => {",
  "    document.title = value;",
  "  }, []);",
  "  return <div>{value}</div>;",
  "};",
  "",
].join("\n");
const HOSTED_CART = [
  "import React, { useEffect, useState } from 'react';",
  "import { createPortal } from 'react-dom';",
  "export const HostedCart = ({ orderId, value }) => {",
  "  const [order, setOrder] = useState(null);",
  "  useEffect(() => {",
  "    const loadOrder = async () => {",
  "      const response = await fetch('/orders/' + orderId);",
  "      setOrder(await response.json());",
  "    };",
  "    void loadOrder();",
  "  }, [orderId]);",
  "  useEffect(() => { document.title = value; }, ['cart']);",
  "  return <div>{order?.id}</div>;",
  "};",
  "",
].join("\n");
const REFORMATTED_HOSTED_CART = HOSTED_CART.replaceAll("'", '"')
  .replace(
    'import React, { useEffect, useState } from "react";\nimport { createPortal } from "react-dom";',
    'import { createPortal } from "react-dom";\nimport React, { useEffect, useState } from "react";',
  )
  .replaceAll("  ", "    ");
const NEW_DERIVED_STATE =
  "export const useBad = (value) => { const [state, setState] = React.useState(0); React.useEffect(() => { setState(value) }, [value]); return state }\n";

const ROWS = (count: number): string =>
  [
    "export const Rows = ({ rows }) => <ul>",
    ...Array.from(
      { length: count },
      () => "  {rows.map((row, index) => <li key={index}>{row}</li>)}",
    ),
    "</ul>;",
    "",
  ].join("\n");

const scan = (directory: string, flags: string[] = [], respectInlineDisables = false) => {
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      directory,
      "--json",
      "--no-score",
      "--no-telemetry",
      "--no-supply-chain",
      ...(respectInlineDisables ? [] : ["--no-respect-inline-disables"]),
      "--no-dead-code",
      "--no-cache",
      "--yes",
      "--blocking",
      "warning",
      ...flags,
    ],
    {
      encoding: "utf-8",
      env: { ...process.env, CI: "true", REACT_DOCTOR_NO_UPDATE_NOTIFIER: "1" },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stdout, result.stderr).not.toBe("");
  return {
    status: result.status,
    report: Schema.decodeUnknownSync(JsonReport)(JSON.parse(result.stdout)),
  };
};

interface ComparisonCase {
  name: string;
  baseSource: string;
  headSource?: string;
  rename?: boolean;
  untracked?: boolean;
  copy?: boolean;
  deleteFile?: boolean;
  expectedCount: number;
  expectedRule?: string;
  expectedLine?: number;
}

const CASES: ComparisonCase[] = [
  {
    name: "new tracked copy",
    baseSource: EFFECT,
    copy: true,
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 5,
  },
  { name: "unchanged tree", baseSource: EFFECT, expectedCount: 0 },
  {
    name: "rename a dependency inside a flagged node",
    baseSource: EFFECT,
    headSource: EFFECT.replaceAll("value", "renamedValue"),
    expectedCount: 0,
  },
  {
    name: "insert an identical violation before an existing one",
    baseSource: EFFECT,
    headSource: EFFECT.replace(
      "  useEffect(() => {",
      "  useEffect(() => { document.title = value; }, []);\n  useEffect(() => {",
    ),
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 3,
  },
  {
    name: "edit inside an existing effect",
    baseSource: EFFECT,
    headSource: EFFECT.replace("document.title = value;", 'document.title = "Title: " + value;'),
    expectedCount: 0,
  },
  {
    name: "edit on the flagged line",
    baseSource: EFFECT,
    headSource: EFFECT.replace("}, []);", "}, []); void 0;"),
    expectedCount: 0,
  },
  { name: "insert lines above", baseSource: EFFECT, headSource: "\n\n" + EFFECT, expectedCount: 0 },
  {
    name: "add a violation inside the flawed function",
    baseSource: EFFECT,
    headSource: EFFECT.replace(
      "  return",
      "  useEffect(() => { document.title = other; }, []);\n  return",
    ),
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 6,
  },
  {
    name: "duplicate count grows from two to three",
    baseSource: ROWS(2),
    headSource: ROWS(3),
    expectedCount: 1,
    expectedRule: "no-array-index-as-key",
    expectedLine: 4,
  },
  {
    name: "two duplicates with one moved",
    baseSource: ROWS(2),
    headSource: ROWS(2).replace("\n  {", "\n\n\n  {"),
    expectedCount: 0,
  },
  { name: "rename unchanged content", baseSource: EFFECT, rename: true, expectedCount: 0 },
  {
    name: "new untracked file",
    baseSource: EFFECT,
    untracked: true,
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 5,
  },
  {
    name: "remove an existing finding",
    baseSource: EFFECT,
    headSource: EFFECT.replace("}, []);", "}, [value]);"),
    expectedCount: 0,
  },
  { name: "delete a file", baseSource: EFFECT, deleteFile: true, expectedCount: 0 },
];

describe("changed scope compares findings through the CLI", () => {
  let directory: string;
  let reportFile: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-new-findings-"));
    reportFile = path.join(directory, "baseline.json");
    writeJson(path.join(directory, "package.json"), {
      name: "new-findings",
      dependencies: { react: "^19.0.0" },
    });
    writeJson(path.join(directory, "doctor.config.json"), {
      rules: { "react-doctor/no-array-index-as-key": "warn" },
    });
    writeFile(path.join(directory, "src/keep.tsx"), "export const Keep = () => <div />;\n");
    initGitRepo(directory);
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it.each(CASES)("$name", (testCase) => {
    const sourcePath = path.join(directory, "src/app.tsx");
    writeFile(sourcePath, testCase.baseSource);
    commitAll(directory, "base findings");
    writeFile(path.join(directory, "src/untouched.tsx"), EFFECT);
    commitAll(directory, "unrelated existing finding");
    const base = scan(directory);
    expect(base.report.diagnostics.length).toBeGreaterThan(0);
    writeJson(reportFile, base.report);
    if (testCase.headSource !== undefined) writeFile(sourcePath, testCase.headSource);
    if (testCase.rename)
      execFileSync("git", ["mv", "src/app.tsx", "src/renamed.tsx"], { cwd: directory });
    if (testCase.untracked || testCase.copy) writeFile(path.join(directory, "src/new.tsx"), EFFECT);
    if (testCase.copy) execFileSync("git", ["add", "src/new.tsx"], { cwd: directory });
    if (testCase.deleteFile) fs.rmSync(sourcePath);
    const flags = testCase.untracked ? ["--include-untracked"] : [];
    const gitResult = scan(directory, ["--scope", "changed", "--base", "HEAD", ...flags]);
    const savedResult = scan(directory, ["--scope", "changed", "--baseline", reportFile, ...flags]);
    for (const result of [gitResult, savedResult]) {
      expect(result.report.error).toBeNull();
      expect(result.report.diagnostics).toHaveLength(testCase.expectedCount);
      expect(result.report.summary.totalDiagnosticCount).toBe(testCase.expectedCount);
      expect(result.status).toBe(testCase.expectedCount === 0 ? 0 : 1);
      expect(result.report.schemaVersion).toBe(3);
      if (result.report.schemaVersion !== 3) throw new Error("Expected schema version 3");
      expect(result.report.baselineDegraded).not.toBe(true);
      expect(result.report.baseline?.matchedCount).toBeDefined();
      if (testCase.expectedRule)
        expect(result.report.diagnostics[0]?.rule).toBe(testCase.expectedRule);
      if (testCase.expectedLine)
        expect(result.report.diagnostics[0]?.line).toBe(testCase.expectedLine);
    }
    if (gitResult.report.schemaVersion === 3 && savedResult.report.schemaVersion === 3) {
      expect(gitResult.report.baseline?.source).toBe("base");
      expect(savedResult.report.baseline?.source).toBe("baseline");
      expect(savedResult.report.baseline?.baselineFile).toBe(reportFile);
      expect(savedResult.report.baseline?.matchedCount).toBe(
        gitResult.report.baseline?.matchedCount,
      );
      expect(savedResult.report.baseline?.fixedCount).toBe(gitResult.report.baseline?.fixedCount);
      expect(savedResult.report.baseline?.baseTotalCount).toBe(
        gitResult.report.baseline?.baseTotalCount,
      );
    }
  });

  it("keeps the HostedCart findings after reformatting and reports only an added derived state", () => {
    const sourcePath = path.join(directory, "src/HostedCart.tsx");
    writeFile(sourcePath, HOSTED_CART);
    commitAll(directory, "base cart findings");
    const base = scan(directory);
    expect(base.report.diagnostics.some((finding) => finding.rule === "exhaustive-deps")).toBe(
      true,
    );
    expect(
      base.report.diagnostics.some(
        (finding) => finding.rule === "no-set-state-after-await-in-effect",
      ),
    ).toBe(true);
    writeJson(reportFile, base.report);
    for (const appended of ["", NEW_DERIVED_STATE]) {
      writeFile(sourcePath, REFORMATTED_HOSTED_CART + appended);
      const gitResult = scan(directory, ["--scope", "changed", "--base", "HEAD"]);
      const savedResult = scan(directory, ["--scope", "changed", "--baseline", reportFile]);
      const fullSavedResult = scan(directory, ["--baseline", reportFile]);
      for (const result of [gitResult, savedResult, fullSavedResult]) {
        expect(result.report.diagnostics.map((finding) => finding.rule)).toEqual(
          appended ? ["no-derived-state"] : [],
        );
        expect(result.report.summary.totalDiagnosticCount).toBe(appended ? 1 : 0);
        expect(result.status).toBe(appended ? 1 : 0);
        if (appended) expect(result.report.diagnostics[0]?.line).toBe(15);
      }
    }
  });

  it.each([
    { ignore: { rules: ["react-hooks/exhaustive-deps"] } },
    { ignore: { tags: ["test-noise"] } },
    { rules: { "react-hooks/exhaustive-deps": "off" } },
    { ignore: { overrides: [{ files: ["src/app.tsx"], rules: ["react-hooks/exhaustive-deps"] }] } },
  ])("applies current config to both sides of a saved comparison: %j", (config) => {
    const sourcePath = path.join(directory, "src/app.tsx");
    writeFile(sourcePath, EFFECT);
    commitAll(directory, "base finding");
    writeJson(reportFile, scan(directory).report);
    writeJson(path.join(directory, "doctor.config.json"), config);
    writeFile(sourcePath, EFFECT + "\n");
    for (const flags of [
      ["--base", "HEAD"],
      ["--baseline", reportFile],
    ]) {
      const result = scan(directory, ["--scope", "changed", ...flags]);
      expect(result.status).toBe(0);
      expect(result.report.diagnostics).toEqual([]);
      if (result.report.schemaVersion !== 3) throw new Error("Expected schema version 3");
      expect(result.report.baseline?.baseTotalCount).toBe(0);
      expect(result.report.baseline?.matchedCount).toBe(0);
    }
  });

  it.each([{ textComponents: ["Label"] }, { rawTextWrapperComponents: ["Button"] }])(
    "rejects changed source filters instead of consuming stale base findings: %j",
    (config) => {
      writeFile(path.join(directory, "src/app.tsx"), EFFECT);
      commitAll(directory, "base");
      const base = scan(directory);
      if (base.report.schemaVersion !== 3) throw new Error("Expected schema version 3");
      expect(base.report.projects[0]?.sourceFilterConfigHash).toMatch(/^[a-f0-9]{64}$/);
      writeJson(reportFile, base.report);
      writeJson(path.join(directory, "doctor.config.json"), config);
      writeFile(path.join(directory, "src/app.tsx"), "\n" + EFFECT);
      for (const flags of [[], ["--scope", "changed"]]) {
        const result = scan(directory, ["--baseline", reportFile, ...flags]);
        expect(result.status).not.toBe(0);
        expect(result.report.error?.message).toContain("source-dependent filters");
      }
    },
  );

  it("rejects changed inline-disable settings and reports without filter metadata", () => {
    writeFile(path.join(directory, "src/app.tsx"), EFFECT);
    commitAll(directory, "base");
    const base = scan(directory);
    writeJson(reportFile, base.report);
    const mismatch = scan(directory, ["--baseline", reportFile], true);
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.report.error?.message).toContain("source-dependent filters");
    if (base.report.schemaVersion !== 3) throw new Error("Expected schema version 3");
    writeJson(reportFile, {
      ...base.report,
      projects: base.report.projects.map(
        ({ sourceFilterConfigHash: _hash, ...project }) => project,
      ),
    });
    const legacy = scan(directory, ["--baseline", reportFile]);
    expect(legacy.status).not.toBe(0);
    expect(legacy.report.error?.message).toContain("source-dependent filter settings");
  });

  it("retains compatible source filtering after line shifts without Git", () => {
    writeJson(path.join(directory, "package.json"), {
      name: "native-fixture",
      dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
    });
    writeJson(path.join(directory, "doctor.config.json"), { rawTextWrapperComponents: ["Button"] });
    const sourcePath = path.join(directory, "src/app.tsx");
    const nativeSource =
      'import { View } from "react-native";\nconst Button = ({ children }) => <View>{children}</View>;\nexport const App = () => <Button>Cancel</Button>;\n';
    writeFile(sourcePath, nativeSource);
    commitAll(directory, "filtered native base");
    const base = scan(directory);
    expect(base.report.diagnostics.filter((finding) => finding.rule === "rn-no-raw-text")).toEqual(
      [],
    );
    writeJson(reportFile, base.report);
    writeFile(
      sourcePath,
      "\n\n" + nativeSource + "export const Added = () => <View>New raw text</View>;\n",
    );
    const gitResult = scan(directory, ["--scope", "changed", "--base", "HEAD"]);
    fs.rmSync(path.join(directory, ".git"), { recursive: true });
    const savedResult = scan(directory, ["--baseline", reportFile]);
    for (const result of [gitResult, savedResult]) {
      expect(result.status).toBe(1);
      expect(result.report.error).toBeNull();
      expect(result.report.diagnostics.map((finding) => [finding.rule, finding.line])).toEqual([
        ["rn-no-raw-text", 6],
      ]);
    }
  });

  it("uses a saved report without Git and rejects a report without fingerprints", () => {
    writeFile(path.join(directory, "src/app.tsx"), EFFECT);
    commitAll(directory, "base");
    const base = scan(directory);
    writeJson(reportFile, base.report);
    fs.rmSync(path.join(directory, ".git"), { recursive: true });
    writeFile(path.join(directory, "src/app.tsx"), "\n" + EFFECT);
    const result = scan(directory, ["--scope", "changed", "--baseline", reportFile]);
    expect(result.status).toBe(0);
    expect(result.report.diagnostics).toEqual([]);
    expect(scan(directory, ["--baseline", reportFile]).report.diagnostics).toEqual([]);
    const legacy = {
      ...base.report,
      diagnostics: base.report.diagnostics.map(
        ({ fingerprint: _fingerprint, ...diagnostic }) => diagnostic,
      ),
    };
    writeJson(reportFile, legacy);
    const invalid = scan(directory, ["--baseline", reportFile]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.report.error?.message).toContain("fingerprints");
  });
});
