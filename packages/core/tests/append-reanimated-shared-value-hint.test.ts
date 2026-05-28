import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { appendReanimatedSharedValueHint } from "../src/utils/append-reanimated-shared-value-hint.js";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";

const ROOT_DIRECTORY = "/home/user/app";

const REACT_COMPILER_IMMUTABILITY_HELP =
  "This value cannot be modified\n\nModifying a value returned from a hook is not allowed. Consider moving the modification into the hook where the value is constructed.";

const REANIMATED_DOCS_ANCHOR =
  "https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/#react-compiler-support";

const buildProject = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
  rootDirectory: ROOT_DIRECTORY,
  projectName: "app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "expo",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: true,
  hasReanimated: true,
  sourceFileCount: 10,
  ...overrides,
});

const buildOxlintStdout = (code: string, message: string): string =>
  JSON.stringify({
    diagnostics: [
      {
        message,
        code,
        severity: "error",
        causes: [],
        url: "",
        help: "",
        filename: "src/components/SpinningIcon.tsx",
        labels: [{ label: "", span: { offset: 0, length: 1, line: 23, column: 5 } }],
        related: [],
      },
    ],
    number_of_files: 1,
    number_of_rules: 1,
  });

describe("appendReanimatedSharedValueHint", () => {
  it("appends the .get()/.set() hint for immutability findings when reanimated is installed", () => {
    const help = appendReanimatedSharedValueHint(
      REACT_COMPILER_IMMUTABILITY_HELP,
      "immutability",
      buildProject(),
    );
    expect(help).toContain(REACT_COMPILER_IMMUTABILITY_HELP);
    expect(help).toContain("`.get()` / `.set()`");
    expect(help).toContain(REANIMATED_DOCS_ANCHOR);
  });

  it("returns just the hint when the upstream help is empty", () => {
    const help = appendReanimatedSharedValueHint("", "immutability", buildProject());
    expect(help).toContain("`.get()` / `.set()`");
    expect(help.startsWith("\n")).toBe(false);
  });

  it("leaves help untouched when reanimated is not installed", () => {
    const help = appendReanimatedSharedValueHint(
      REACT_COMPILER_IMMUTABILITY_HELP,
      "immutability",
      buildProject({ hasReanimated: false }),
    );
    expect(help).toBe(REACT_COMPILER_IMMUTABILITY_HELP);
  });

  it("leaves help untouched for other react-hooks-js rules", () => {
    const help = appendReanimatedSharedValueHint(
      REACT_COMPILER_IMMUTABILITY_HELP,
      "refs",
      buildProject(),
    );
    expect(help).toBe(REACT_COMPILER_IMMUTABILITY_HELP);
  });
});

describe("parseOxlintOutput react-hooks-js immutability messaging", () => {
  it("surfaces the Reanimated accessor hint end-to-end for RN projects", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(immutability)",
      REACT_COMPILER_IMMUTABILITY_HELP,
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), ROOT_DIRECTORY);

    expect(diagnostic.message).toBe("React Compiler can't optimize this code");
    expect(diagnostic.category).toBe("React Compiler");
    expect(diagnostic.help).toContain("`.get()` / `.set()`");
    expect(diagnostic.help).toContain(REANIMATED_DOCS_ANCHOR);
  });

  it("does not surface the hint when reanimated is not installed", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(immutability)",
      REACT_COMPILER_IMMUTABILITY_HELP,
    );
    const [diagnostic] = parseOxlintOutput(
      stdout,
      buildProject({ hasReanimated: false }),
      ROOT_DIRECTORY,
    );

    expect(diagnostic.help).not.toContain("`.get()` / `.set()`");
  });

  it("does not surface the hint for other React Compiler rules", () => {
    const stdout = buildOxlintStdout("react-hooks-js(refs)", "Cannot access ref during render");
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), ROOT_DIRECTORY);

    expect(diagnostic.help).not.toContain("`.get()` / `.set()`");
  });
});
