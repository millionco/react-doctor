import { describe, expect, it } from "vite-plus/test";
import type { WorkspaceScanTelemetry } from "@react-doctor/language-server";
import { buildLspScanEventAttributes } from "../src/lsp-telemetry.js";

const scan = (overrides: Partial<WorkspaceScanTelemetry> = {}): WorkspaceScanTelemetry => ({
  trigger: "initial",
  startedAtEpochMs: 1000,
  durationMs: 2500,
  projectCount: 2,
  chunkCount: 3,
  filesWithDiagnostics: 4,
  totalDiagnostics: 5,
  errorCount: 2,
  warningCount: 3,
  diagnosticsByCategory: { Performance: 4, "Dead Code": 1 },
  lintDegraded: false,
  lintIncompleteChunks: 0,
  ...overrides,
});

describe("buildLspScanEventAttributes", () => {
  it("projects the scan into flat span attributes", () => {
    const attributes = buildLspScanEventAttributes(scan());
    expect(attributes).toMatchObject({
      trigger: "initial",
      durationMs: 2500,
      projectCount: 2,
      chunkCount: 3,
      filesWithDiagnostics: 4,
      totalDiagnostics: 5,
      errorCount: 2,
      warningCount: 3,
      lintDegraded: false,
      lintIncompleteChunks: 0,
    });
  });

  it("namespaces per-category counts with key-safe names", () => {
    const attributes = buildLspScanEventAttributes(scan());
    expect(attributes["diag.category.performance"]).toBe(4);
    expect(attributes["diag.category.dead_code"]).toBe(1);
  });

  it("marks a zero-diagnostic, healthy scan as clean", () => {
    const attributes = buildLspScanEventAttributes(
      scan({ totalDiagnostics: 0, errorCount: 0, warningCount: 0, diagnosticsByCategory: {} }),
    );
    expect(attributes.scanClean).toBe(true);
  });

  it("is not clean when lint was degraded even with zero diagnostics", () => {
    const attributes = buildLspScanEventAttributes(
      scan({ totalDiagnostics: 0, diagnosticsByCategory: {}, lintDegraded: true }),
    );
    expect(attributes.scanClean).toBe(false);
    expect(attributes.lintDegraded).toBe(true);
  });
});
