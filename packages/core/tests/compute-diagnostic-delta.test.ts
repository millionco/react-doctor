import { describe, expect, it, vi } from "vite-plus/test";
import { computeDiagnosticDelta, DIAGNOSTIC_DELTA_IDENTITY } from "@react-doctor/core";
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
  it("skips evidence and location matching when a group cannot add findings", () => {
    const baseDiagnostics = Array.from({ length: 800 }, (_, index) =>
      makeDiagnostic({ line: index + 1 }),
    );
    const readLine = vi.fn(() => null);
    const readEvidence = vi.fn(() => null);
    const mapBaseLine = vi.fn((_filePath: string, line: number) => line);
    for (const headCount of [800, 400, 0]) {
      const delta = computeDiagnosticDelta({
        baseDiagnostics,
        headDiagnostics: baseDiagnostics.slice(0, headCount),
        readHeadLine: readLine,
        readBaseLine: readLine,
        readHeadEvidence: readEvidence,
        readBaseEvidence: readEvidence,
        mapBaseLine,
      });
      expect(delta.newDiagnostics).toEqual([]);
      expect(delta.fixedCount).toBe(800 - headCount);
    }
    expect(readLine).not.toHaveBeenCalled();
    expect(readEvidence).not.toHaveBeenCalled();
    expect(mapBaseLine).not.toHaveBeenCalled();
  });

  it("maps each base location once when selecting an added duplicate", () => {
    const baseDiagnostics = Array.from({ length: 800 }, (_, index) =>
      makeDiagnostic({ line: index + 1, fingerprint: "same" }),
    );
    const added = makeDiagnostic({ line: 1000, fingerprint: "same" });
    const mapBaseLine = vi.fn((_filePath: string, line: number) => line + 10);
    const delta = computeDiagnosticDelta({
      baseDiagnostics,
      headDiagnostics: [
        added,
        ...baseDiagnostics.map((diagnostic) => ({
          ...diagnostic,
          line: diagnostic.line + 10,
        })),
      ],
      readHeadLine: () => null,
      readBaseLine: () => null,
      mapBaseLine,
    });
    expect(delta.newDiagnostics).toEqual([added]);
    expect(mapBaseLine).toHaveBeenCalledTimes(baseDiagnostics.length);
  });

  it("uses a detector identity instead of changed source or summary text", () => {
    const baseDiagnostic = makeDiagnostic({ message: "2 copies repeat about 10 lines" });
    const headDiagnostic = makeDiagnostic({ message: "2 copies repeat about 14 lines" });
    Object.defineProperty(baseDiagnostic, DIAGNOSTIC_DELTA_IDENTITY, {
      enumerable: true,
      value: "jsx:stable-family",
    });
    Object.defineProperty(headDiagnostic, DIAGNOSTIC_DELTA_IDENTITY, {
      enumerable: true,
      value: "jsx:stable-family",
    });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [headDiagnostic],
      baseDiagnostics: [baseDiagnostic],
      readHeadLine: () => "<Link />",
      readBaseLine: () => "<Button />",
    });

    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("counts findings rather than changes to a detector summary", () => {
    const baseDiagnostic = makeDiagnostic({ matchByOccurrence: true });
    const headDiagnostic = makeDiagnostic({ matchByOccurrence: true });
    Object.defineProperty(baseDiagnostic, DIAGNOSTIC_DELTA_IDENTITY, {
      enumerable: true,
      value: "jsx:stable-family\0occurrences:2",
    });
    Object.defineProperty(headDiagnostic, DIAGNOSTIC_DELTA_IDENTITY, {
      enumerable: true,
      value: "jsx:stable-family\0occurrences:3",
    });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [headDiagnostic],
      baseDiagnostics: [baseDiagnostic],
      readHeadLine: () => "same summary",
      readBaseLine: () => "same summary",
    });

    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("restricts persisted fingerprints to the same file or an explicit rename", () => {
    const baseDiagnostics = [makeDiagnostic({ fingerprint: "stable" })];
    const headDiagnostics = [
      makeDiagnostic({ filePath: "src/Renamed.tsx", line: 50, column: 30, fingerprint: "stable" }),
    ];
    const input = {
      headDiagnostics,
      baseDiagnostics,
      readHeadLine: () => null,
      readBaseLine: () => null,
    };
    expect(computeDiagnosticDelta({ ...input, renamedFiles: {} }).newDiagnostics).toEqual(
      headDiagnostics,
    );
    const renamed = computeDiagnosticDelta({
      ...input,
      renamedFiles: { "src/App.tsx": "src/Renamed.tsx" },
    });
    expect(renamed.newDiagnostics).toEqual([]);
    expect(renamed.crossFileMatchCount).toBe(1);
  });

  it("matches equal rule counts when fingerprints differ", () => {
    const delta = computeDiagnosticDelta({
      headDiagnostics: [makeDiagnostic({ fingerprint: "new-source", matchByOccurrence: true })],
      baseDiagnostics: [makeDiagnostic({ fingerprint: "old-source", matchByOccurrence: true })],
      renamedFiles: {},
      readHeadLine: () => null,
      readBaseLine: () => null,
    });
    expect(delta.newDiagnostics).toHaveLength(0);
  });

  it("uses shifted line positions to locate an added duplicate before the old finding", () => {
    const added = makeDiagnostic({ line: 10, fingerprint: "same" });
    const old = makeDiagnostic({ line: 30, fingerprint: "same" });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [added, old],
      baseDiagnostics: [makeDiagnostic({ line: 10, fingerprint: "same" })],
      readHeadLine: () => null,
      readBaseLine: () => null,
      mapBaseLine: (_filePath, line) => line + 20,
    });
    expect(delta.newDiagnostics).toEqual([added]);
  });

  it("retains a stable fingerprint when its message changes and a new finding uses the old message", () => {
    const original = makeDiagnostic({
      fingerprint: "original",
      message: "Missing dependency: value",
    });
    const edited = makeDiagnostic({
      fingerprint: "original",
      message: "Missing dependencies: value, other",
      line: 20,
    });
    const added = makeDiagnostic({ fingerprint: "added", message: original.message });
    const delta = computeDiagnosticDelta({
      baseDiagnostics: [original],
      headDiagnostics: [added, edited],
      readHeadLine: () => null,
      readBaseLine: () => null,
    });
    expect(delta.newDiagnostics).toEqual([added]);
  });

  it("retains the least similar extra finding after a reformat", () => {
    const added = makeDiagnostic({ line: 10, message: "Missing dependency: payment" });
    const old = makeDiagnostic({ line: 40, message: "Missing dependency: value" });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [added, old],
      baseDiagnostics: [makeDiagnostic({ line: 10, message: "Missing dependency: value" })],
      readHeadLine: () => "reformatted code",
      readBaseLine: () => "original code",
    });
    expect(delta.newDiagnostics).toEqual([added]);
    expect(delta.ruleCountMatchCount).toBe(1);
  });

  it("updates candidate ranks after another finding consumes their closest base match", () => {
    const added = makeDiagnostic({ line: 11, fingerprint: "reformatted" });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ line: 10, fingerprint: "reformatted" }),
        added,
        makeDiagnostic({ line: 105, fingerprint: "reformatted" }),
      ],
      baseDiagnostics: [
        makeDiagnostic({ line: 10, fingerprint: "original" }),
        makeDiagnostic({ line: 100, fingerprint: "original" }),
      ],
      readHeadLine: () => null,
      readBaseLine: () => null,
    });
    expect(delta.newDiagnostics).toEqual([added]);
  });

  it("does not move allowance between different rules or files", () => {
    const added = [makeDiagnostic({ rule: "other-rule" }), makeDiagnostic({ filePath: "new.tsx" })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: added,
      baseDiagnostics: [makeDiagnostic(), makeDiagnostic()],
      readHeadLine: () => "same",
      readBaseLine: () => "same",
    });
    expect(delta.newDiagnostics).toEqual(added);
  });

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

  it("matches unchanged diagnostic evidence after it moves to another file", () => {
    const flagged = "items.map((item, index) => <Row key={index} />)";
    const delta = computeDiagnosticDelta({
      renamedFiles: { "src/App.tsx": "src/Rows.tsx" },
      headDiagnostics: [makeDiagnostic({ filePath: "src/Rows.tsx", line: 4 })],
      baseDiagnostics: [makeDiagnostic({ filePath: "src/App.tsx", line: 10 })],
      readHeadLine: lineReaderFrom({ "src/Rows.tsx:4": flagged }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
    expect(delta.crossFileMatchCount).toBe(1);
  });

  it("does not match changed evidence after a file move", () => {
    const delta = computeDiagnosticDelta({
      headDiagnostics: [makeDiagnostic({ filePath: "src/Rows.tsx", line: 4 })],
      baseDiagnostics: [makeDiagnostic({ filePath: "src/App.tsx", line: 10 })],
      readHeadLine: lineReaderFrom({
        "src/Rows.tsx:4": "rows.map((row, rowIndex) => <Row key={rowIndex} />)",
      }),
      readBaseLine: lineReaderFrom({
        "src/App.tsx:10": "items.map((item, index) => <Row key={index} />)",
      }),
    });
    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(1);
    expect(delta.crossFileMatchCount).toBe(0);
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

  it("prefers the same-file occurrence when identical evidence is copied", () => {
    const flagged = "items.map((item, index) => <Row key={index} />)";
    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/CopiedRows.tsx" }),
        makeDiagnostic({ filePath: "src/App.tsx" }),
      ],
      baseDiagnostics: [makeDiagnostic({ filePath: "src/App.tsx" })],
      readHeadLine: lineReaderFrom({
        "src/CopiedRows.tsx:10": flagged,
        "src/App.tsx:10": flagged,
      }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
    });

    expect(delta.newDiagnostics.map((diagnostic) => diagnostic.filePath)).toEqual([
      "src/CopiedRows.tsx",
    ]);
    expect(delta.crossFileMatchCount).toBe(0);
  });

  it("matches the same rule after the flagged content changes", () => {
    const base = [makeDiagnostic({ line: 10 })];
    const head = [makeDiagnostic({ line: 10 })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      readHeadLine: lineReaderFrom({ "src/App.tsx:10": "rows.map((x, idx) => <Row key={idx} />)" }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": "items.map((x, i) => <Row key={i} />)" }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("matches the same rule after the diagnostic message changes", () => {
    const flagged = "}, [selectedIds]);";
    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({
          rule: "exhaustive-deps",
          message: "Missing dependencies: select, selectUpwards",
        }),
      ],
      baseDiagnostics: [
        makeDiagnostic({ rule: "exhaustive-deps", message: "Missing dependency: select" }),
      ],
      readHeadLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": flagged }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("matches equal counts after the diagnosed source range changes", () => {
    const delta = computeDiagnosticDelta({
      headDiagnostics: [makeDiagnostic({ endLine: 12 })],
      baseDiagnostics: [makeDiagnostic({ endLine: 12 })],
      readHeadLine: () => "}, [persistKey]);",
      readBaseLine: () => "}, [persistKey]);",
      readHeadEvidence: () => "useEffect(() => {\n  setSrc(undefined);\n}, [persistKey]);",
      readBaseEvidence: () => "useEffect(() => {\n  setOpen(false);\n}, [persistKey]);",
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("matches a pre-existing occurrence-matched finding whose flagged line was reformatted", () => {
    const base = [
      makeDiagnostic({
        plugin: "react-doctor",
        rule: "iframe-has-title",
        category: "Accessibility",
        matchByOccurrence: true,
        line: 10,
      }),
    ];
    const head = [
      makeDiagnostic({
        plugin: "react-doctor",
        rule: "iframe-has-title",
        category: "Accessibility",
        matchByOccurrence: true,
        line: 12,
      }),
    ];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      // Prettier reflowed the multi-line <iframe> onto one line; the iframe
      // still lacks a title, so the finding is pre-existing, not new.
      readHeadLine: lineReaderFrom({ "src/App.tsx:12": '<iframe src={url} className="embed" />' }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": "<iframe" }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("matches a non-Accessibility rule carrying matchByOccurrence even when the line text changed", () => {
    const base = [
      makeDiagnostic({
        plugin: "react-doctor",
        rule: "iframe-missing-sandbox",
        category: "Security",
        matchByOccurrence: true,
        line: 10,
      }),
    ];
    const head = [
      makeDiagnostic({
        plugin: "react-doctor",
        rule: "iframe-missing-sandbox",
        category: "Security",
        matchByOccurrence: true,
        line: 10,
      }),
    ];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      readHeadLine: lineReaderFrom({ "src/App.tsx:10": '<iframe src={url} title="Embed" />' }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": "<iframe src={url} />" }),
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("still surfaces a genuinely new extra occurrence of an occurrence-matched finding", () => {
    const occurrenceMatched = (line: number): Diagnostic =>
      makeDiagnostic({
        plugin: "react-doctor",
        rule: "iframe-has-title",
        category: "Accessibility",
        matchByOccurrence: true,
        line,
      });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [occurrenceMatched(10), occurrenceMatched(42)],
      baseDiagnostics: [occurrenceMatched(10)],
      readHeadLine: lineReaderFrom({
        "src/App.tsx:10": "<iframe src={a} />",
        "src/App.tsx:42": "<iframe src={b} />",
      }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": "<iframe src={a} />" }),
    });
    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(0);
  });

  it("reserves a reformatted same-file occurrence before matching a cross-file copy", () => {
    const occurrenceMatched = (filePath: string): Diagnostic =>
      makeDiagnostic({
        filePath,
        rule: "iframe-has-title",
        category: "Accessibility",
        matchByOccurrence: true,
      });
    const delta = computeDiagnosticDelta({
      headDiagnostics: [occurrenceMatched("src/CopiedFrame.tsx"), occurrenceMatched("src/App.tsx")],
      baseDiagnostics: [occurrenceMatched("src/App.tsx")],
      readHeadLine: lineReaderFrom({
        "src/CopiedFrame.tsx:10": "<iframe",
        "src/App.tsx:10": '<iframe src={url} className="embed" />',
      }),
      readBaseLine: lineReaderFrom({ "src/App.tsx:10": "<iframe" }),
    });

    expect(delta.newDiagnostics.map((diagnostic) => diagnostic.filePath)).toEqual([
      "src/CopiedFrame.tsx",
    ]);
    expect(delta.fixedCount).toBe(0);
    expect(delta.crossFileMatchCount).toBe(0);
  });

  it("falls back to file, rule, and message matching when source is unreadable", () => {
    const base = [makeDiagnostic({ line: 10 })];
    const head = [makeDiagnostic({ line: 99 })];
    const delta = computeDiagnosticDelta({
      headDiagnostics: head,
      baseDiagnostics: base,
      readHeadLine: () => null,
      readBaseLine: () => null,
    });
    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
  });

  it("does not match unreadable diagnostics across files", () => {
    const delta = computeDiagnosticDelta({
      headDiagnostics: [makeDiagnostic({ filePath: "src/New.tsx" })],
      baseDiagnostics: [makeDiagnostic({ filePath: "src/Old.tsx" })],
      readHeadLine: () => null,
      readBaseLine: () => null,
    });
    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(1);
  });
});
