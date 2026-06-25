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

  it("frames a shared-fix group as one task and tells the agent to group by fixGroupId", () => {
    // Four keyed-state sites that one `key` prop clears, all carrying the same
    // fixGroupId the core layer stamps.
    const diagnostics: Diagnostic[] = [12, 18, 24, 30].map((line) =>
      makeDiagnostic({
        rule: "no-derived-state-effect",
        title: "Derived state stored in an effect",
        severity: "warning",
        message: "Your users briefly see stale state on every prop change.",
        line,
        fixGroupId: "abc123",
      }),
    );

    const payload = buildHandoffPayload({ diagnostics, projectName: "demo" });

    // One numbered task, framed as a single fix — not "×4".
    expect(payload.match(/^\d+\. /gm)?.length).toBe(1);
    expect(payload).toContain("one fix · 4 sites");
    expect(payload).not.toContain("×4");
    // The agent is told to collapse by fixGroupId when reading diagnostics.json.
    expect(payload).toContain("fixGroupId");

    const directoryMatch = payload.match(/Full results for all 4 issues[^:]*: (\S+)/);
    if (directoryMatch) fs.rmSync(directoryMatch[1]!, { recursive: true, force: true });
  });

  it("flags a migration-scale bucket with sample + sign-off guidance", () => {
    const diagnostics: Diagnostic[] = [];
    for (let fileIndex = 0; fileIndex < 45; fileIndex += 1) {
      diagnostics.push(
        makeDiagnostic({
          rule: "react-compiler-no-manual-memoization",
          title: "Manual memoization",
          filePath: `src/components/widget-${fileIndex}.tsx`,
          line: fileIndex + 1,
        }),
      );
    }

    const payload = buildHandoffPayload({ diagnostics, projectName: "demo" });

    expect(payload).toContain("Migration-scale (45 files)");
    expect(payload).toContain("get the code owner's sign-off");

    const directory = payload.match(/Full results for all \d+ issues[^:]*: (\S+)/)![1]!;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("warns about a migration-scale rule that ranks outside the shown top-N", () => {
    // Three small rules fill the shown top-N; the migration-scale rule lands
    // outside it (scan order), so it only reaches the closing summary.
    const diagnostics: Diagnostic[] = [
      makeDiagnostic({ rule: "rule-a", title: "Rule A", filePath: "src/a.tsx" }),
      makeDiagnostic({ rule: "rule-b", title: "Rule B", filePath: "src/b.tsx" }),
      makeDiagnostic({ rule: "rule-c", title: "Rule C", filePath: "src/c.tsx" }),
    ];
    for (let fileIndex = 0; fileIndex < 45; fileIndex += 1) {
      diagnostics.push(
        makeDiagnostic({
          rule: "react-compiler-no-manual-memoization",
          title: "Manual memoization",
          filePath: `src/widgets/widget-${fileIndex}.tsx`,
          line: fileIndex + 1,
        }),
      );
    }

    const payload = buildHandoffPayload({ diagnostics, projectName: "demo" });

    expect(payload).toContain("Some of the rest are migration-scale");
    expect(payload).toContain("Manual memoization (45 files)");
    // It's not one of the shown groups, so it gets no inline per-rule note.
    expect(payload).not.toMatch(/^ {3}Migration-scale \(/m);

    const directory = payload.match(/Full results for all \d+ issues[^:]*: (\S+)/)![1]!;
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
