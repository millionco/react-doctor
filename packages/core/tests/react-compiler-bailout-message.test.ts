import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  buildOxlintStdout,
  buildProject,
  TEST_ROOT_DIRECTORY,
} from "./helpers/oxlint-parse-harness.js";

const ASYNC_USE_MEMO_REASON = "useMemo() callbacks may not be async or generator functions";
const ASYNC_USE_MEMO_DETAIL =
  "useMemo() callbacks are called once and must synchronously return a value";
const GENERIC_COMPILER_MESSAGE =
  "This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the compiler can optimize it.";

describe("parseOxlintOutput react-hooks-js bail-out reason in primary message", () => {
  it("weaves the reason summary into the message and leaves the elaboration in help", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(use-memo)",
      `${ASYNC_USE_MEMO_REASON}\n\n${ASYNC_USE_MEMO_DETAIL}`,
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain("misses React Compiler's automatic memoization");
    expect(diagnostic.message).toContain(ASYNC_USE_MEMO_REASON);
    expect(diagnostic.help).toBe(ASYNC_USE_MEMO_DETAIL);
  });

  it("does not repeat a single-line reason in help", () => {
    const stdout = buildOxlintStdout("react-hooks-js(use-memo)", ASYNC_USE_MEMO_REASON);
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain(ASYNC_USE_MEMO_REASON);
    expect(diagnostic.help).not.toContain(ASYNC_USE_MEMO_REASON);
  });

  it("falls back to the generic message when the compiler emits no reason", () => {
    const stdout = buildOxlintStdout("react-hooks-js(use-memo)", "");
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toBe(GENERIC_COMPILER_MESSAGE);
  });

  it("keeps compiler-internal `todo` reasons out of the message", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(todo)",
      "(BuildHIR::lowerExpression) Handle TaggedTemplateExpression expressions",
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toBe(GENERIC_COMPILER_MESSAGE);
    expect(diagnostic.help).toContain("BuildHIR::lowerExpression");
  });

  it("strips oxlint's leading Error: label from the reason", () => {
    const stdout = buildOxlintStdout("react-hooks-js(use-memo)", `Error: ${ASYNC_USE_MEMO_REASON}`);
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain(`: ${ASYNC_USE_MEMO_REASON}. Rewrite`);
    expect(diagnostic.message).not.toContain("Error:");
    expect(diagnostic.help).not.toContain("Error:");
  });

  it("strips oxlint's leading Warning: label, even behind whitespace", () => {
    const stdout = buildOxlintStdout("react-hooks-js(purity)", "  Warning: This value is impure");
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain(": This value is impure. Rewrite");
    expect(diagnostic.message).not.toContain("Warning:");
  });

  it("does not duplicate the trailing period of a reason summary", () => {
    const stdout = buildOxlintStdout("react-hooks-js(purity)", "This value is impure.");
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain(": This value is impure. Rewrite");
  });
});
