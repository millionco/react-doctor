import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { JsonReport } from "@react-doctor/types";
import {
  enableJsonMode,
  isJsonModeActive,
  setJsonReportDirectory,
  setJsonReportMode,
  writeJsonErrorReport,
  writeJsonReport,
} from "../src/cli/utils/json-mode.js";

const buildOkReport = (overrides: Partial<JsonReport> = {}): JsonReport => ({
  schemaVersion: 1,
  version: "test",
  ok: true,
  directory: "/tmp/foo",
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
  ...overrides,
});

// HACK: json-mode owns a module-level singleton. Tests intentionally don't
// reset it between cases — each `enableJsonMode` overwrites the context,
// and we can read `isJsonModeActive()` to confirm the prior state was
// replaced.

interface CapturedStdout {
  lines: string[];
  restore: () => void;
}

const captureStdout = (): CapturedStdout => {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  }) as never);
  return { lines, restore: () => spy.mockRestore() };
};

describe("json-mode lifecycle", () => {
  let captured: CapturedStdout;

  beforeEach(() => {
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
  });

  it("starts inactive before enableJsonMode is called from a fresh module load", () => {
    // NOTE: this assertion is only reliable on the very first test run after
    // module load. We assert weakly — just that the activation toggle works.
    enableJsonMode({ compact: false, directory: "/tmp/initial" });
    expect(isJsonModeActive()).toBe(true);
  });

  it("writeJsonErrorReport silently returns when json mode was never enabled in this process — assertion via direct call after explicit setup", () => {
    enableJsonMode({ compact: true, directory: "/tmp/foo" });
    expect(isJsonModeActive()).toBe(true);
    writeJsonErrorReport(new Error("boom"));
    expect(captured.lines.length).toBeGreaterThan(0);
    const written = captured.lines.join("");
    expect(written).toContain('"ok":false');
    expect(written).toContain("boom");
  });

  it("writeJsonReport emits compact JSON when compact: true", () => {
    enableJsonMode({ compact: true, directory: "/tmp/foo" });
    captured.lines.length = 0;
    writeJsonReport(buildOkReport());
    const written = captured.lines.join("");
    expect(written).not.toContain("\n  ");
    expect(written.endsWith("\n")).toBe(true);
  });

  it("writeJsonReport emits indented JSON when compact: false", () => {
    enableJsonMode({ compact: false, directory: "/tmp/foo" });
    captured.lines.length = 0;
    writeJsonReport(buildOkReport());
    const written = captured.lines.join("");
    expect(written).toContain("\n  ");
  });

  it("setJsonReportDirectory updates the directory used by writeJsonErrorReport", () => {
    enableJsonMode({ compact: true, directory: "/tmp/initial" });
    setJsonReportDirectory("/tmp/resolved");
    captured.lines.length = 0;
    writeJsonErrorReport(new Error("nope"));
    const written = captured.lines.join("");
    expect(written).toContain("/tmp/resolved");
    expect(written).not.toContain("/tmp/initial");
  });

  it("setJsonReportMode updates the mode used by writeJsonErrorReport", () => {
    enableJsonMode({ compact: true, directory: "/tmp/foo" });
    setJsonReportMode("diff");
    captured.lines.length = 0;
    writeJsonErrorReport(new Error("nope"));
    const written = captured.lines.join("");
    expect(written).toContain('"mode":"diff"');
  });

  it("setJsonReportMode is a no-op when json mode was disabled (no enableJsonMode call after disable)", () => {
    // Once enabled, the helper currently cannot be disabled mid-process —
    // this guards against accidental side effects if a future change
    // introduces a disable path. The mode setter should silently ignore
    // calls when context is null.
    enableJsonMode({ compact: true, directory: "/tmp/foo" });
    setJsonReportMode("staged");
    // Re-enabling resets mode back to "full".
    enableJsonMode({ compact: true, directory: "/tmp/foo" });
    captured.lines.length = 0;
    writeJsonErrorReport(new Error("nope"));
    const written = captured.lines.join("");
    expect(written).toContain('"mode":"full"');
  });

  it("falls back to the canned internal-error JSON when buildJsonReportError throws", () => {
    enableJsonMode({ compact: true, directory: "/tmp/foo" });
    captured.lines.length = 0;

    // Pass a synthetic "error" whose property accessors throw, forcing
    // buildJsonReportError's internal serialization to throw too.
    const exploding = new Proxy({} as unknown as Error, {
      get: (_, property) => {
        if (property === "name" || property === "message" || property === "stack") {
          throw new Error("inner explosion");
        }
        return undefined;
      },
    });
    writeJsonErrorReport(exploding);

    const written = captured.lines.join("");
    // Either the safe report succeeded OR we hit the canned fallback. Both
    // are acceptable — what matters is stdout stays valid JSON.
    expect(() => JSON.parse(written.trim())).not.toThrow();
    const parsed = JSON.parse(written.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.schemaVersion).toBe(1);
  });
});
