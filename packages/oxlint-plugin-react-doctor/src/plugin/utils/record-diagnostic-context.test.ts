import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import type { DiagnosticContextRange } from "./diagnostic-context-range.js";
import { exhaustiveDeps } from "../rules/react-builtins/exhaustive-deps.js";
import { wrapWithSemanticContext } from "./wrap-with-semantic-context.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("diagnostic ownership transport", () => {
  it("records UTF-8 ranges while preserving the host diagnostic", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-report-context-"));
    directories.push(directory);
    const source = [
      'import { useEffect } from "react";',
      'const heading = "é😀";',
      "export const App = ({ value }) => {",
      "  const callback = () => { console.log(value); };",
      "  useEffect(callback, []);",
      "  return <div>{heading}</div>;",
      "};",
    ].join("\n");
    const filename = path.join(directory, "app.tsx");
    fs.writeFileSync(filename, source);
    const rule = wrapWithSemanticContext(exhaustiveDeps);
    const result = runRule(rule, source, {
      filename,
      includeLocations: true,
      settings: { "react-doctor": { diagnosticContextDirectory: directory } },
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ line: 5, nodeType: "ArrayExpression" });
    expect(result.diagnostics[0].message).not.toContain("context");
    const artifact = fs.readdirSync(directory).find((entry) => entry.endsWith(".json"));
    expect(artifact).toBeDefined();
    const ranges: DiagnosticContextRange[] = JSON.parse(
      fs.readFileSync(path.join(directory, artifact ?? ""), "utf8"),
    );
    const buffer = Buffer.from(source);
    expect(
      ranges.map(({ offset, length }) => buffer.subarray(offset, offset + length).toString("utf8")),
    ).toEqual(["useEffect(callback, [])", "() => { console.log(value); }"]);
  });

  it("continues reporting when ownership transport is unavailable", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-report-blocked-"));
    directories.push(directory);
    const blockedDirectory = path.join(directory, "blocked");
    fs.writeFileSync(blockedDirectory, "");
    const source =
      'import { useEffect } from "react"; const App = ({ value }) => { useEffect(() => console.log(value), []); return <div />; };';
    const result = runRule(wrapWithSemanticContext(exhaustiveDeps), source, {
      settings: { "react-doctor": { diagnosticContextDirectory: blockedDirectory } },
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
