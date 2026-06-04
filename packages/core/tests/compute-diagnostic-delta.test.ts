import { describe, expect, it } from "vite-plus/test";
import { computeDiagnosticDelta } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  message: "Array index used as React key",
  help: "",
  line: 10,
  column: 1,
  category: "Correctness",
  ...overrides,
});

// Maps `filePath:line` -> source text, so tests control the fingerprint snippet.
const lineReaderFrom =
  (lines: Record<string, string>) =>
  (filePath: string, line: number): string | null =>
    lines[`${filePath}:${line}`] ?? null;

describe("computeDiagnosticDelta", () => {
  it("flags a diagnostic present only in head as new", () => {
    const head = [makeDiagnostic()];
    const lines = lineReaderFrom({ "src/App.tsx:10": "items.map((x, i) => <Row key={i} />)" });
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: [],
      readHeadLine: lines,
      readBaseLine: lines,
    });
    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(0);
  });

  it("treats a shifted-but-identical diagnostic as pre-existing, not new", () => {
    const flagged = "items.map((x, i) => <Row key={i} />)";
    // Same code, moved from line 10 (base) to line 25 (head) by inserts above.
    const base = [makeDiagnostic({ line: 10 })];
    const head = [makeDiagnostic({ line: 25 })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      readHeadLine: lineReaderFrom({ "src/App.tsx:25": flagged }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("counts a base-only diagnostic as fixed", () => {
    const flagged = "items.map((x, i) => <Row key={i} />)";
    const delta = computeDiagnosticDelta({
      headDiagnostics: [],
      baseDiagnostics: [makeDiagnostic({ line: 10 })],
      readHeadLine: () => null,
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(1);
  });

  it("matches identical findings by count (one extra occurrence is new)", () => {
    const flagged = "items.map((x, i) => <Row key={i} />)";
    const base = [makeDiagnostic({ line: 10 })];
    const head = [makeDiagnostic({ line: 10 }), makeDiagnostic({ line: 42 })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      readHeadLine: lineReaderFrom({ "src/App.tsx:10": flagged, "src/App.tsx:42": flagged }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
    });
    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.newDiagnostics[0]?.line).toBe(42);
    expect(delta.fixedCount).toBe(0);
  });

  it("distinguishes the same rule on different line content", () => {
    const base = [makeDiagnostic({ line: 10 })];
    const head = [makeDiagnostic({ line: 10 })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      // The flagged line's content changed, so it's a new instance (+ the old one fixed).
      readHeadLine: lineReaderFrom({ "src/App.tsx:10": "rows.map((x, idx) => <Row key={idx} />)" }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": "items.map((x, i) => <Row key={i} />)" }),
    });
    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(1);
  });

  it("falls back to (file, rule) order matching when line text is unreadable", () => {
    const base = [makeDiagnostic({ line: 10 })];
    const head = [makeDiagnostic({ line: 99 })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      readHeadLine: () => null,
      readBaseLine: () => null,
    });
    // No snippet on either side -> same (file, rule) fingerprint -> matched.
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });
});
