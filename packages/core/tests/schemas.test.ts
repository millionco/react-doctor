import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticIdentity, JsonReportV1, Severity } from "@react-doctor/core";
// `Diagnostic` and `JsonReport` are imported directly from the
// `schemas.js` module rather than the package barrel because the
// barrel intentionally elides them — the same names exist as TS
// types in `@react-doctor/core`'s `types/` subtree, and re-exporting
// the Schema versions would collide. The Schema versions ARE the
// in-tree validators; consumers wanting them reach in directly.
import { Diagnostic, JsonReport } from "@react-doctor/core/schemas";

describe("Diagnostic schema", () => {
  it("decodes the minimal shape (required fields only)", () => {
    const decoded = Schema.decodeUnknownSync(Diagnostic)({
      filePath: "/repo/src/App.tsx",
      plugin: "react-doctor",
      rule: "no-derived-state",
      severity: "error",
      message: "Avoid useState(propX)",
      help: "Use propX directly",
      line: 12,
      column: 4,
      category: "Correctness",
    });
    expect(decoded.filePath).toBe("/repo/src/App.tsx");
    expect(decoded.severity).toBe("error");
    expect(decoded.url).toBeUndefined();
    expect(decoded.suppressionHint).toBeUndefined();
  });

  it("decodes optional fields when present", () => {
    const decoded = Schema.decodeUnknownSync(Diagnostic)({
      filePath: "/repo/src/Button.tsx",
      plugin: "react-doctor",
      rule: "no-barrel-import",
      severity: "warning",
      message: "Barrel import",
      help: "Import directly",
      url: "https://www.react.doctor/rules/no-barrel-import",
      line: 1,
      column: 1,
      category: "Bundle Size",
      suppressionHint: "// react-doctor-disable-next-line no-barrel-import",
    });
    expect(decoded.url).toBe("https://www.react.doctor/rules/no-barrel-import");
    expect(decoded.suppressionHint).toBe("// react-doctor-disable-next-line no-barrel-import");
  });

  it("decodes precise span + related-location metadata when present", () => {
    const decoded = Schema.decodeUnknownSync(Diagnostic)({
      filePath: "/repo/src/App.tsx",
      plugin: "react-doctor",
      rule: "no-derived-state-effect",
      severity: "warning",
      message: "Derived state",
      help: "Compute during render",
      line: 12,
      column: 4,
      offset: 240,
      length: 18,
      endLine: 12,
      endColumn: 22,
      category: "State & Effects",
      relatedLocations: [
        {
          filePath: "/repo/src/App.tsx",
          line: 9,
          column: 9,
          offset: 180,
          length: 4,
          message: "prop declared here",
        },
      ],
    });
    expect(decoded.offset).toBe(240);
    expect(decoded.length).toBe(18);
    expect(decoded.endColumn).toBe(22);
    expect(decoded.relatedLocations?.[0]?.message).toBe("prop declared here");
  });

  it("rejects an unknown severity value", () => {
    expect(() =>
      Schema.decodeUnknownSync(Diagnostic)({
        filePath: "/repo/src/App.tsx",
        plugin: "react-doctor",
        rule: "x",
        severity: "info",
        message: "x",
        help: "x",
        line: 1,
        column: 1,
        category: "x",
      }),
    ).toThrow();
  });

  it("round-trips via encode / decode", () => {
    const original = new Diagnostic({
      filePath: "/repo/src/App.tsx",
      plugin: "react",
      rule: "no-danger",
      severity: "warning",
      message:
        "dangerouslySetInnerHTML bypasses React escaping, so untrusted HTML can execute script in the user's browser.",
      help: "Render structured React content instead, or sanitize trusted HTML before passing it to dangerouslySetInnerHTML.",
      line: 10,
      column: 1,
      category: "Security",
    });
    const encoded = Schema.encodeUnknownSync(Diagnostic)(original);
    const decoded = Schema.decodeUnknownSync(Diagnostic)(encoded);
    expect(decoded.filePath).toBe(original.filePath);
    expect(decoded.rule).toBe(original.rule);
    expect(decoded.line).toBe(original.line);
  });
});

describe("Severity schema", () => {
  it("accepts the two literal values", () => {
    expect(Schema.decodeUnknownSync(Severity)("error")).toBe("error");
    expect(Schema.decodeUnknownSync(Severity)("warning")).toBe("warning");
  });

  it("rejects anything else", () => {
    expect(() => Schema.decodeUnknownSync(Severity)("info")).toThrow();
    expect(() => Schema.decodeUnknownSync(Severity)(undefined)).toThrow();
  });
});

describe("buildDiagnosticIdentity", () => {
  it("produces the documented shape", () => {
    expect(
      buildDiagnosticIdentity({
        filePath: "/repo/src/App.tsx",
        line: 12,
        column: 4,
        plugin: "react-doctor",
        rule: "no-derived-state",
      }),
    ).toBe("/repo/src/App.tsx::12:4::react-doctor/no-derived-state");
  });

  it("is deterministic across calls with the same input", () => {
    const inputs = {
      filePath: "/a/b/c.tsx",
      line: 1,
      column: 1,
      plugin: "p",
      rule: "r",
    } as const;
    expect(buildDiagnosticIdentity(inputs)).toBe(buildDiagnosticIdentity(inputs));
  });

  it("changes when any field changes", () => {
    const base = {
      filePath: "/a/b/c.tsx",
      line: 1,
      column: 1,
      plugin: "p",
      rule: "r",
    } as const;
    const seen = new Set<string>();
    seen.add(buildDiagnosticIdentity(base));
    seen.add(buildDiagnosticIdentity({ ...base, filePath: "/a/b/d.tsx" }));
    seen.add(buildDiagnosticIdentity({ ...base, line: 2 }));
    seen.add(buildDiagnosticIdentity({ ...base, column: 2 }));
    seen.add(buildDiagnosticIdentity({ ...base, plugin: "q" }));
    seen.add(buildDiagnosticIdentity({ ...base, rule: "s" }));
    expect(seen.size).toBe(6);
  });
});

describe("JsonReport (v1)", () => {
  it("decodes a minimal v1 report", () => {
    const decoded = Schema.decodeUnknownSync(JsonReport)({
      schemaVersion: 1,
      version: "0.2.3",
      ok: true,
      directory: "/repo",
      mode: "full",
      diff: null,
      projects: [],
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        affectedFileCount: 0,
        totalDiagnosticCount: 0,
        score: 100,
        scoreLabel: "Excellent",
      },
      elapsedMilliseconds: 42,
      error: null,
    });
    expect(decoded.schemaVersion).toBe(1);
    expect(decoded instanceof JsonReportV1).toBe(true);
  });

  it("rejects a report missing the schemaVersion discriminator", () => {
    expect(() =>
      Schema.decodeUnknownSync(JsonReport)({
        version: "0.2.3",
        ok: true,
        directory: "/repo",
        mode: "full",
        diff: null,
        projects: [],
        diagnostics: [],
        summary: {
          errorCount: 0,
          warningCount: 0,
          affectedFileCount: 0,
          totalDiagnosticCount: 0,
          score: null,
          scoreLabel: null,
        },
        elapsedMilliseconds: 0,
        error: null,
      }),
    ).toThrow();
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      Schema.decodeUnknownSync(JsonReportV1)({
        schemaVersion: 1,
        version: "0.2.3",
        ok: true,
        directory: "/repo",
        mode: "incremental",
        diff: null,
        projects: [],
        diagnostics: [],
        summary: {
          errorCount: 0,
          warningCount: 0,
          affectedFileCount: 0,
          totalDiagnosticCount: 0,
          score: null,
          scoreLabel: null,
        },
        elapsedMilliseconds: 0,
        error: null,
      }),
    ).toThrow();
  });
});
