import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("gives incompatible-library a library-specific action, not the generic 'rewrite it' copy", () => {
    const reason =
      "This API returns functions which cannot be memoized without leading to stale UI";
    const stdout = buildOxlintStdout("react-hooks-js(incompatible-library)", reason);
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain(reason);
    expect(diagnostic.message).toContain("not a bug in your code");
    expect(diagnostic.message).toContain(
      "react-doctor-disable-next-line react-hooks-js/incompatible-library",
    );
    expect(diagnostic.message).not.toContain("Rewrite the flagged code");
  });

  it("describes set-state-in-effect as render advice instead of a compiler bailout", () => {
    const reason = "Calling setState synchronously within an effect can trigger cascading renders";
    const stdout = buildOxlintStdout("react-hooks-js(set-state-in-effect)", reason);
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.message).toContain(reason);
    expect(diagnostic.message).toContain("extra render");
    expect(diagnostic.message).toContain("browser API");
    expect(diagnostic.message).not.toContain("React Compiler's automatic memoization");
    expect(diagnostic.message).not.toContain("Rewrite the flagged code");
  });
});

const parseRefFinding = (source: string, labeledText: string) => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "react-compiler-ref-advice-"));
  try {
    const filename = "Widget.tsx";
    writeFileSync(join(rootDirectory, filename), source);
    const index = source.indexOf(labeledText);
    const beforeSpan = source.slice(0, index);
    const stdout = JSON.stringify({
      diagnostics: [
        {
          filename,
          code: "react-hooks-js(refs)",
          severity: "warning",
          message: "Cannot access refs during render",
          help: "Avoid accessing the current value during render.",
          labels: [
            {
              span: {
                offset: Buffer.byteLength(beforeSpan),
                length: Buffer.byteLength(labeledText),
                line: beforeSpan.split("\n").length,
                column: index - beforeSpan.lastIndexOf("\n"),
              },
            },
          ],
        },
      ],
    });
    const [diagnostic] = parseOxlintOutput(stdout, buildProject({ rootDirectory }), rootDirectory);
    return diagnostic;
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
};

describe("parseOxlintOutput advice for React Compiler ref-property spans", () => {
  it("suggests a direct ref binding for the exact JSX ref span after Unicode", () => {
    const diagnostic = parseRefFinding(
      'const label = "café";\nconst Widget = ({ modal }) => <dialog ref={modal.ref} />;',
      "modal.ref",
    );
    expect(diagnostic.plugin).toBe("react-hooks-js");
    expect(diagnostic.rule).toBe("refs");
    expect(diagnostic.length).toBe(Buffer.byteLength("modal.ref"));
    expect(diagnostic.message).toContain("React Compiler could not analyze this JSX ref prop");
    expect(diagnostic.help).toContain("If this property stores a ref object, destructure it");
    expect(diagnostic.help).toContain("Cannot access refs during render");
  });

  it.each([
    ["<dialog ref={modal.ref.current} />", "modal.ref.current"],
    ["<dialog ref={modal.ref.current} />", "modal.ref"],
    ["<dialog data-id={modal.ref} />", "modal.ref"],
    ["<dialog ref={modal?.ref} />", "modal?.ref"],
    ["<dialog ref={openModal().ref} />", "openModal().ref"],
    ["<dialog ref={modal.ref} />", "modal"],
  ])("keeps the compiler's usual advice for %s with span %s", (jsx, labeledText) => {
    const diagnostic = parseRefFinding("export const Widget = () => " + jsx + ";", labeledText);
    expect(diagnostic.message).toContain("Cannot access refs during render");
    expect(diagnostic.help).toBe("Avoid accessing the current value during render.");
  });
});
