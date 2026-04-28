import { describe, expect, it } from "vitest";
import {
  cleanDiagnosticMessage,
  parseOxlintOutput,
  parseRuleCode,
  resolveDiagnosticCategory,
} from "../src/oxlint-output";

describe("parseRuleCode", () => {
  it("parses eslint-style plugin(rule) codes", () => {
    expect(parseRuleCode("react-doctor(no-fetch-in-effect)")).toEqual({
      plugin: "react-doctor",
      rule: "no-fetch-in-effect",
    });
  });

  it("returns unknown plugin when code does not match", () => {
    expect(parseRuleCode("plain-code")).toEqual({ plugin: "unknown", rule: "plain-code" });
  });
});

describe("resolveDiagnosticCategory", () => {
  it("maps known react-doctor rules", () => {
    expect(resolveDiagnosticCategory("react-doctor", "no-fetch-in-effect")).toBe("State & Effects");
  });

  it("falls back to plugin default", () => {
    expect(resolveDiagnosticCategory("react", "unknown-rule")).toBe("Correctness");
  });
});

describe("cleanDiagnosticMessage", () => {
  it("normalizes react-hooks-js messages", () => {
    const cleaned = cleanDiagnosticMessage(
      "Some detail /path/file.tsx:1:2 extra",
      "help text",
      "react-hooks-js",
      "rule",
    );
    expect(cleaned.message).toBe("React Compiler can't optimize this code");
    expect(cleaned.help.length).toBeGreaterThan(0);
  });
});

describe("parseOxlintOutput", () => {
  it("parses json diagnostics for jsx files", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "msg",
          code: "react-doctor(no-fetch-in-effect)",
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: "/app/Counter.tsx",
          labels: [{ label: "x", span: { offset: 0, length: 1, line: 3, column: 4 } }],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    const diagnostics = parseOxlintOutput(stdout);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("/app/Counter.tsx");
    expect(diagnostics[0].plugin).toBe("react-doctor");
    expect(diagnostics[0].rule).toBe("no-fetch-in-effect");
    expect(diagnostics[0].line).toBe(3);
    expect(diagnostics[0].column).toBe(4);
  });

  it("filters out non-jsx filenames", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "m",
          code: "react(no-danger)",
          severity: "warning",
          causes: [],
          url: "",
          help: "",
          filename: "/app/bad.ts",
          labels: [],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });
    expect(parseOxlintOutput(stdout)).toHaveLength(0);
  });

  it("throws on invalid json", () => {
    expect(() => parseOxlintOutput("not json")).toThrow(/Failed to parse oxlint output/);
  });
});
