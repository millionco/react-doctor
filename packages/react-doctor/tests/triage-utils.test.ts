import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildTriageRulePrompt } from "../src/cli/utils/build-triage-rule-prompt.js";
import { ensureReactDoctorGitignore } from "../src/cli/utils/ensure-react-doctor-gitignore.js";
import {
  emptyTriageState,
  pruneTriageState,
  readTriageState,
  updateTriageState,
  writeTriageState,
} from "../src/cli/utils/triage-state.js";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "apps/web/src/app.tsx",
  plugin: "react-doctor",
  rule: "prefer-module-scope-pure-function",
  severity: "warning",
  title: "Hoist pure helpers",
  message: "Hoist the pure helper to module scope so it is not reallocated each render.",
  help: "Move the helper above the component.",
  line: 12,
  column: 3,
  category: "Performance",
  ...overrides,
});

describe("buildTriageRulePrompt", () => {
  it("builds a focused single-rule prompt with verification instructions", () => {
    const prompt = buildTriageRulePrompt({
      ruleKey: "react-doctor/prefer-module-scope-pure-function",
      diagnostics: [makeDiagnostic()],
      projectName: "openpaper",
      outputDirectory: "/tmp/react-doctor-triage",
    });

    expect(prompt).toContain("Fix exactly one React Doctor rule in openpaper");
    expect(prompt).toContain("Fix only react-doctor/prefer-module-scope-pure-function");
    expect(prompt).toContain("apps/web/src/app.tsx:12");
    expect(prompt).toContain('react-doctor triage --output-dir "/tmp/react-doctor-triage"');
  });
});

describe("triage state", () => {
  it("round-trips and prunes stale rule keys", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-triage-state-"));
    try {
      const state = updateTriageState(emptyTriageState(), {
        prompted: ["react-doctor/a", "react-doctor/stale"],
        skipped: ["react-doctor/b"],
        disabled: ["react-doctor/c"],
      });
      writeTriageState(directory, state);

      const pruned = pruneTriageState(
        readTriageState(directory),
        new Set(["react-doctor/a", "react-doctor/b"]),
      );

      expect(pruned.prompted).toEqual(["react-doctor/a"]);
      expect(pruned.skipped).toEqual(["react-doctor/b"]);
      expect(pruned.disabled).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("ensureReactDoctorGitignore", () => {
  it("adds the local react-doctor state directory once", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-gitignore-"));
    try {
      const didWrite = ensureReactDoctorGitignore(directory);
      const didWriteAgain = ensureReactDoctorGitignore(directory);

      expect(didWrite).toBe(true);
      expect(didWriteAgain).toBe(false);
      expect(fs.readFileSync(path.join(directory, ".gitignore"), "utf8")).toBe(".react-doctor/\n");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
