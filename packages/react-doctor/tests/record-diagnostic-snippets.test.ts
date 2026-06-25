import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildScrambledDiagnosticSnippets } from "../src/cli/utils/record-diagnostic-snippets.js";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "test-rule",
  severity: "error",
  message: "x",
  help: "",
  line: 1,
  column: 1,
  category: "Test",
  ...overrides,
});

const toByteOffset = (source: string, utf16Index: number): number =>
  Buffer.byteLength(source.slice(0, utf16Index), "utf8");

describe("buildScrambledDiagnosticSnippets", () => {
  it("scrambles the minimal node and carries the rule identity", () => {
    const source = `import { useEffect } from "react";
useEffect(() => { doSecretThing(secretValue); }, []);`;
    const utf16Index = source.indexOf("useEffect(() =>");
    const diagnostic = buildDiagnostic({
      offset: toByteOffset(source, utf16Index),
      length: "useEffect".length,
      category: "Performance",
      rule: "no-effect",
    });

    const snippets = buildScrambledDiagnosticSnippets([diagnostic], () => source);

    expect(snippets).toHaveLength(1);
    expect(snippets[0].nodeType).toBe("CallExpression");
    expect(snippets[0].rule).toBe("react-doctor/no-effect");
    expect(snippets[0].category).toBe("Performance");
    expect(snippets[0].severity).toBe("error");
    expect(snippets[0].source).not.toMatch(/doSecretThing/);
    expect(snippets[0].source).not.toMatch(/secretValue/);
    expect(snippets[0].hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("converts oxlint UTF-8 byte offsets so non-ASCII source picks the right node", () => {
    // The emoji + accents before the target make the byte offset diverge from
    // the UTF-16 index; if the conversion were skipped the offset would land on
    // the wrong node (or none).
    const source = `const banner = "héllo wörld 😀 from accounting";
import { useEffect } from "react";
useEffect(() => { doSecretThing(secretValue); }, []);`;
    const utf16Index = source.indexOf("useEffect(() =>");
    const diagnostic = buildDiagnostic({
      offset: toByteOffset(source, utf16Index),
      length: "useEffect".length,
    });

    const snippets = buildScrambledDiagnosticSnippets([diagnostic], () => source);

    expect(snippets).toHaveLength(1);
    expect(snippets[0].nodeType).toBe("CallExpression");
    expect(snippets[0].source).not.toMatch(/banner|accounting|doSecretThing/);
  });

  it("dedupes structurally identical snippets by hash across files", () => {
    const makeSource = (name: string): string =>
      `import { useEffect } from "react";
useEffect(() => { ${name}(); }, []);`;
    const sourceByPath: Record<string, string> = {
      "src/a.tsx": makeSource("fetchAlpha"),
      "src/b.tsx": makeSource("fetchBravo"),
    };
    const utf16Index = sourceByPath["src/a.tsx"].indexOf("useEffect(() =>");
    const diagnostics = [
      buildDiagnostic({
        filePath: "src/a.tsx",
        offset: toByteOffset(sourceByPath["src/a.tsx"], utf16Index),
        length: "useEffect".length,
      }),
      buildDiagnostic({
        filePath: "src/b.tsx",
        offset: toByteOffset(sourceByPath["src/b.tsx"], utf16Index),
        length: "useEffect".length,
      }),
    ];

    const snippets = buildScrambledDiagnosticSnippets(
      diagnostics,
      (filePath) => sourceByPath[filePath] ?? null,
    );

    expect(snippets).toHaveLength(1);
  });

  it("skips diagnostics without a span or with an unreadable file", () => {
    const withoutSpan = buildDiagnostic();
    const unreadable = buildDiagnostic({ filePath: "src/missing.tsx", offset: 0, length: 1 });

    const snippets = buildScrambledDiagnosticSnippets([withoutSpan, unreadable], () => null);

    expect(snippets).toEqual([]);
  });
});
