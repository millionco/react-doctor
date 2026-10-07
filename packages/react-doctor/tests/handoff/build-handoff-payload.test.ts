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

    expect(payload).toContain(`Review and fix the top ${TOP_ERRORS_DISPLAY_COUNT}`);
    expect(payload).toContain("demo");
    expect(payload).not.toContain("add React Doctor to CI");
    expect(payload).not.toContain("https://react.doctor/ci");
    expect(payload.match(/^\d+\. /gm)?.length).toBe(TOP_ERRORS_DISPLAY_COUNT);

    const directoryMatch = payload.match(/Full results for all 5 issues[^:]*: (\S+)/);
    expect(directoryMatch).not.toBeNull();
    const directory = directoryMatch![1]!;
    expect(fs.existsSync(directory)).toBe(true);
    expect(fs.existsSync(`${directory}/diagnostics.json`)).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("frames a shared-fix group as one task and tells the agent to group by fixGroupId", () => {
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

    expect(payload.match(/^\d+\. /gm)?.length).toBe(1);
    expect(payload).toContain("one fix · 4 sites");
    expect(payload).not.toContain("×4");
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
    expect(payload).not.toMatch(/^ {3}Migration-scale \(/m);

    const directory = payload.match(/Full results for all \d+ issues[^:]*: (\S+)/)![1]!;
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
