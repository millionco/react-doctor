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

describe("createLintCache", () => {
  it("returns a hit only when path + mtime + size all match", () => {
    const cache = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    const diagnostics = [diagnostic("no-array-index-key")];
    cache.store("/p/a.tsx", { mtimeMs: 1000, size: 50 }, diagnostics);

    expect(cache.lookup("/p/a.tsx", { mtimeMs: 1000, size: 50 })).toEqual(diagnostics);
    expect(cache.lookup("/p/a.tsx", { mtimeMs: 1001, size: 50 })).toBeNull(); // mtime changed
    expect(cache.lookup("/p/a.tsx", { mtimeMs: 1000, size: 51 })).toBeNull(); // size changed
    expect(cache.lookup("/p/unknown.tsx", { mtimeMs: 1000, size: 50 })).toBeNull();
  });

  it("distinguishes a cached-clean file ([]) from a miss (null)", () => {
    const cache = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    cache.store("/p/clean.tsx", { mtimeMs: 1, size: 1 }, []);
    expect(cache.lookup("/p/clean.tsx", { mtimeMs: 1, size: 1 })).toEqual([]);
    expect(cache.lookup("/p/never.tsx", { mtimeMs: 1, size: 1 })).toBeNull();
  });

  it("persists to disk and reloads under the same fingerprint", () => {
    const first = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    first.store("/p/a.tsx", { mtimeMs: 7, size: 8 }, [diagnostic("rule-a")]);
    first.store("/p/clean.tsx", { mtimeMs: 9, size: 10 }, []);
    first.flush();

    const reloaded = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    expect(reloaded.lookup("/p/a.tsx", { mtimeMs: 7, size: 8 })).toEqual([diagnostic("rule-a")]);
    expect(reloaded.lookup("/p/clean.tsx", { mtimeMs: 9, size: 10 })).toEqual([]);
  });

  it("discards a persisted cache when the fingerprint changes", () => {
    const first = createLintCache({ projectDirectory: projectDir, fingerprint: "fp1" });
    first.store("/p/a.tsx", { mtimeMs: 7, size: 8 }, [diagnostic("rule-a")]);
    first.flush();

    const reloaded = createLintCache({ projectDirectory: projectDir, fingerprint: "fp2" });
    expect(reloaded.lookup("/p/a.tsx", { mtimeMs: 7, size: 8 })).toBeNull();
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
