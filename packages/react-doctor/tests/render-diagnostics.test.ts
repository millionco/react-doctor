import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { printDiagnostics } from "../src/cli/utils/render-diagnostics.js";
import { buildDiagnostic } from "./regressions/_helpers.js";

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");

const stripAnsi = (text: string): string => text.replace(ANSI_ESCAPE_PATTERN, "");

describe("printDiagnostics", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const printedLines: string[] = [];

  beforeEach(() => {
    printedLines.length = 0;
    consoleLogSpy = vi.spyOn(globalThis.console, "log").mockImplementation((line = "") => {
      printedLines.push(String(line));
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("caps default output to top categories and rules with a hidden summary", async () => {
    const diagnostics = [
      buildDiagnostic({ category: "Correctness", rule: "a", severity: "error" }),
      buildDiagnostic({ category: "Correctness", rule: "b", severity: "error" }),
      buildDiagnostic({ category: "Correctness", rule: "c", severity: "error" }),
      buildDiagnostic({ category: "Correctness", rule: "d", severity: "error" }),
      buildDiagnostic({ category: "Performance", rule: "perf", severity: "warning" }),
      buildDiagnostic({ category: "Architecture", rule: "arch", severity: "warning" }),
      buildDiagnostic({ category: "React Native", rule: "rn", severity: "warning" }),
      buildDiagnostic({ category: "Security", rule: "sec", severity: "warning" }),
      buildDiagnostic({ category: "Accessibility", rule: "a11y", severity: "warning" }),
    ];

    await Effect.runPromise(printDiagnostics(diagnostics, false, "/repo"));

    const output = stripAnsi(printedLines.join("\n"));
    expect(output).toContain("Correctness");
    expect(output).toContain("react-doctor/a");
    expect(output).toContain("react-doctor/c");
    expect(output).not.toContain("react-doctor/d");
    expect(output).toContain("more error");
    expect(output).toContain("more warning");
    expect(output).toContain("--staged");
  });

  it("prints verbose triage metadata, opt-out help, and absolute paths", async () => {
    await Effect.runPromise(
      printDiagnostics(
        [
          buildDiagnostic({
            rule: "rn-no-raw-text",
            message: "Raw text outside Text",
            help: "Wrap it in Text",
            filePath: "src/app.tsx",
          }),
        ],
        true,
        "/repo",
      ),
    );

    const output = stripAnsi(printedLines.join("\n"));
    expect(output).toContain("Why: React Native only permits strings");
    expect(output).toContain("Impact: This is a user-visible crash risk");
    expect(output).toContain("Confidence: high; effort: low");
    expect(output).toContain('{ "rules": { "react-doctor/rn-no-raw-text": "off" } }');
    expect(output).toContain("/repo/src/app.tsx:1");
  });
});
