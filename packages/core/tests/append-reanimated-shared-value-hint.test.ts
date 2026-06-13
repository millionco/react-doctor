import { describe, expect, it } from "vite-plus/test";
import { appendReanimatedSharedValueHint } from "../src/utils/append-reanimated-shared-value-hint.js";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  buildOxlintStdout,
  buildProject,
  TEST_ROOT_DIRECTORY,
} from "./helpers/oxlint-parse-harness.js";

const REACT_COMPILER_IMMUTABILITY_HELP =
  "This value cannot be modified\n\nModifying a value returned from a hook is not allowed. Consider moving the modification into the hook where the value is constructed.";

const REANIMATED_DOCS_ANCHOR =
  "https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/#react-compiler-support";

describe("appendReanimatedSharedValueHint", () => {
  it("appends the .get()/.set() hint for immutability findings when reanimated is installed", () => {
    const help = appendReanimatedSharedValueHint(
      REACT_COMPILER_IMMUTABILITY_HELP,
      "immutability",
      buildProject({ hasReanimated: true }),
    );
    expect(help).toContain(REACT_COMPILER_IMMUTABILITY_HELP);
    expect(help).toContain("`.get()` / `.set()`");
    expect(help).toContain(REANIMATED_DOCS_ANCHOR);
  });

  it("returns just the hint when the upstream help is empty", () => {
    const help = appendReanimatedSharedValueHint(
      "",
      "immutability",
      buildProject({ hasReanimated: true }),
    );
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
      buildProject({ hasReanimated: true }),
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
    const [diagnostic] = parseOxlintOutput(
      stdout,
      buildProject({ hasReanimated: true }),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostic.title).toBe("React Compiler can't optimize this");
    expect(diagnostic.message).toContain("misses React Compiler's automatic memoization");
    expect(diagnostic.message).toContain("This value cannot be modified");
    expect(diagnostic.category).toBe("Performance");
    expect(diagnostic.help).toContain("Modifying a value returned from a hook is not allowed");
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
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostic.help).not.toContain("`.get()` / `.set()`");
  });

  it("does not surface the hint for other React Compiler rules", () => {
    const stdout = buildOxlintStdout("react-hooks-js(refs)", "Cannot access ref during render");
    const [diagnostic] = parseOxlintOutput(
      stdout,
      buildProject({ hasReanimated: true }),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostic.help).not.toContain("`.get()` / `.set()`");
  });
});
