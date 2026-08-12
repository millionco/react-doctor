import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

describe("parseOxlintOutput with missing code field", () => {
  it("handles diagnostics with no code field without crashing", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Parse error: unexpected token",
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: "src/components/widget.tsx",
          labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    expect(() => {
      parseOxlintOutput(stdout, buildProject(), "/home/user/app");
    }).not.toThrow();
  });

  it("handles diagnostics with undefined code field", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Parse error",
          code: undefined,
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: "src/components/widget.tsx",
          labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    expect(() => {
      parseOxlintOutput(stdout, buildProject(), "/home/user/app");
    }).not.toThrow();
  });

  it("handles diagnostics with null code field", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Parse error",
          code: null,
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: "src/components/widget.tsx",
          labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    expect(() => {
      parseOxlintOutput(stdout, buildProject(), "/home/user/app");
    }).not.toThrow();
  });

  it("handles diagnostics with empty string code field", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Parse error",
          code: "",
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: "src/components/widget.tsx",
          labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    expect(() => {
      parseOxlintOutput(stdout, buildProject(), "/home/user/app");
    }).not.toThrow();
  });
});
