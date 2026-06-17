import * as fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { TOP_ERRORS_DISPLAY_COUNT } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { buildHandoffPayload } from "../../src/cli/utils/build-handoff-payload.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "rule",
  severity: "error",
  title: "Title",
  message: "Impact message.",
  help: "Fix it.",
  line: 1,
  column: 1,
  category: "Bugs",
  ...overrides,
});

describe("buildHandoffPayload", () => {
  it("lists only the top N rules and points at the full-results directory", () => {
    const diagnostics: Diagnostic[] = [];
    // 5 distinct rules so the top-N cap is exercised.
    for (let ruleIndex = 0; ruleIndex < 5; ruleIndex += 1) {
      diagnostics.push(
        makeDiagnostic({
          rule: `rule-${ruleIndex}`,
          title: `Rule ${ruleIndex}`,
          line: ruleIndex + 1,
        }),
      );
    }

    const payload = buildHandoffPayload({ diagnostics, projectName: "demo" });

    expect(payload).toContain(`Fix the top ${TOP_ERRORS_DISPLAY_COUNT}`);
    expect(payload).toContain("demo");
    // The agent copy-prompt carries no CI marketing — the interactive handoff
    // prompt is the single once-per-repo pitch, so the agent never re-asks it.
    expect(payload).not.toContain("add React Doctor to CI");
    expect(payload).not.toContain("https://react.doctor/ci");
    // Exactly TOP_ERRORS_DISPLAY_COUNT numbered entries.
    expect(payload.match(/^\d+\. /gm)?.length).toBe(TOP_ERRORS_DISPLAY_COUNT);

    // The full-results directory is written and referenced, and exists.
    const directoryMatch = payload.match(/Full results for all 5 issues[^:]*: (\S+)/);
    expect(directoryMatch).not.toBeNull();
    const directory = directoryMatch![1]!;
    expect(fs.existsSync(directory)).toBe(true);
    expect(fs.existsSync(`${directory}/diagnostics.json`)).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
