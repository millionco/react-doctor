import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Diagnostic as CoreDiagnostic } from "@react-doctor/core";
import { computeConfigFingerprint } from "@react-doctor/core";
import { createLintCache } from "../../src/core/lint-cache.js";

let projectDir: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-lint-cache-test-"));
  // node_modules present → cache lands in node_modules/.cache (isolated).
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const diagnostic = (rule: string): CoreDiagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule,
  severity: "warning",
  message: `msg ${rule}`,
  help: "help",
  line: 1,
  column: 1,
  category: "Correctness",
});

const fileIdentity = (contentHash: string) => ({ contentHash });

describe("createLintCache", () => {
  it("returns a hit only when path and content hash match", () => {
    const cache = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    const diagnostics = [diagnostic("no-array-index-key")];
    cache.store("/p/a.tsx", fileIdentity("hash-a"), diagnostics);

    expect(cache.lookup("/p/a.tsx", fileIdentity("hash-a"))).toEqual(diagnostics);
    expect(cache.lookup("/p/a.tsx", fileIdentity("hash-b"))).toBeNull();
    expect(cache.lookup("/p/unknown.tsx", fileIdentity("hash-a"))).toBeNull();
  });

  it("distinguishes a cached-clean file ([]) from a miss (null)", () => {
    const cache = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    const identity = fileIdentity("clean");
    cache.store("/p/clean.tsx", identity, []);
    expect(cache.lookup("/p/clean.tsx", identity)).toEqual([]);
    expect(cache.lookup("/p/never.tsx", identity)).toBeNull();
  });

  it("persists to disk and reloads under the same fingerprint", () => {
    const first = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    first.store("/p/a.tsx", fileIdentity("hash-a"), [diagnostic("rule-a")]);
    first.store("/p/clean.tsx", fileIdentity("clean"), []);
    first.flush();

    const reloaded = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    expect(reloaded.lookup("/p/a.tsx", fileIdentity("hash-a"))).toEqual([diagnostic("rule-a")]);
    expect(reloaded.lookup("/p/clean.tsx", fileIdentity("clean"))).toEqual([]);
  });

  it("discards a persisted cache when the fingerprint changes", () => {
    const first = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    first.store("/p/a.tsx", fileIdentity("hash-a"), [diagnostic("rule-a")]);
    first.flush();

    const reloaded = createLintCache({ projectDirectory: projectDir, fingerprint: "fp2" });
    expect(reloaded.lookup("/p/a.tsx", fileIdentity("hash-a"))).toBeNull();
  });
});

describe("computeConfigFingerprint", () => {
  it("is stable for unchanged inputs and changes when a config file changes", () => {
    // Canonical `doctor.config.*` config — not the legacy
    // `react-doctor.config.json`, which core no longer reads.
    const configPath = path.join(projectDir, "doctor.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ rules: {} }));

    const a = computeConfigFingerprint(projectDir, "1.0.0");
    const b = computeConfigFingerprint(projectDir, "1.0.0");
    expect(a).toBe(b);

    // Different version → different fingerprint.
    expect(computeConfigFingerprint(projectDir, "1.0.1")).not.toBe(a);

    // Changed config content (size differs) → different fingerprint.
    fs.writeFileSync(configPath, JSON.stringify({ rules: { "react-doctor/x": "error" } }));
    expect(computeConfigFingerprint(projectDir, "1.0.0")).not.toBe(a);
  });
});
