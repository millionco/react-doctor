import { parseSync } from "oxc-parser";
import { isAstNode } from "../../utils/is-ast-node.js";
import { describe, expect, it } from "vite-plus/test";
import { exhaustiveDeps } from "./exhaustive-deps.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";

interface ArgumentSummaryOptions {
  readonly helper?: string;
  readonly call?: string;
  readonly setup?: string;
  readonly prelude?: string;
  readonly dependencies?: string;
}

const runArgumentSummary = ({
  helper = "function compare(previous, current) { return previous.id === current.id; }",
  call = "compare(previous, snapshot)",
  setup = "",
  prelude = "",
  dependencies = "snapshot.id, onValue",
}: ArgumentSummaryOptions = {}) =>
  runRule(
    exhaustiveDeps,
    `
  import { useEffect } from "react";
  ${prelude}
  const previous = { id: "fixed" };
  ${helper}
  export const Panel = ({ id, extra, onValue }) => {
    const snapshot = { id, extra };
    ${setup}
    useEffect(() => {
      const receive = () => onValue(${call});
      window.addEventListener("update", receive);
      return () => window.removeEventListener("update", receive);
    }, [${dependencies}]);
    return null;
  };
`,
  );

describe("exhaustive-deps helper argument summaries", () => {
  it.each([
    ["direct comparator", {}],
    [
      "const alias chain",
      { prelude: "const select = compare; const read = select;", call: "read(previous, snapshot)" },
    ],
    ["const alias", { prelude: "const select = compare;", call: "select(previous, snapshot)" }],
    [
      "const arrow",
      { helper: "const compare = (previous, current) => previous.id === current.id;" },
    ],
    [
      "transparent function",
      { helper: "const compare = ((previous, current) => previous.id === current.id) as any;" },
    ],
    [
      "independent nested receiver",
      {
        helper:
          "function compare(previous, current) { function unused() { return arguments[0].extra; } return previous.id === current.id; }",
      },
    ],
    [
      "data key named arguments",
      {
        helper:
          "function compare(previous, current) { const metadata = { arguments: 1 }; return previous.id === current.id && metadata.arguments; }",
      },
    ],
    ["data key named eval", { prelude: "const metadata = { eval: 1 }; consume(metadata.eval);" }],
  ])("preserves %s", (_description, options: ArgumentSummaryOptions) => {
    expect(runArgumentSummary(options)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it.each([
    [
      "own arguments",
      {
        helper: "function compare(previous, current) { return current.id && arguments[1].extra; }",
      },
    ],
    [
      "nested lexical arguments",
      {
        helper:
          "function compare(previous, current) { const read = () => arguments[1].extra; return current.id && read(); }",
      },
    ],
    [
      "erased arguments binding",
      {
        helper:
          "function compare(previous, current) { type arguments = unknown; return current.id && arguments[1].extra; }",
      },
    ],
    [
      "call transport",
      {
        helper: "function compare(current) { return current.extra; }",
        call: "compare.call(null, snapshot, previous)",
      },
    ],
    [
      "apply transport",
      {
        helper: "function compare(previous, current) { return previous.extra && current.id; }",
        call: "compare.apply(null, snapshot)",
        setup: "snapshot[0] = snapshot; snapshot[1] = previous; snapshot.length = 2;",
      },
    ],
    [
      "bound function",
      {
        helper:
          "function select(previous, current) { return current.extra; } const compare = select.bind(null, previous);",
        call: "compare(snapshot)",
      },
    ],
    [
      "factory function",
      {
        helper:
          "function create() { return (current) => current.extra; } const compare = create();",
        call: "compare(snapshot)",
      },
    ],
    [
      "member invocation",
      {
        helper:
          "const reader = { compare(previous, current) { return current.id && this.extra; } };",
        call: "reader.compare(previous, snapshot)",
      },
    ],
    [
      "receiver",
      { helper: "function compare(previous, current) { return current.id && this.extra; }" },
    ],
    [
      "new target",
      { helper: "function compare(previous, current) { return current.id && new.target; }" },
    ],
    [
      "default parameter input",
      { helper: "function compare(previous, current = arguments[1]) { return current.id; }" },
    ],
    [
      "erased this position",
      {
        helper:
          "function compare(this: unknown, previous, current) { return previous.id && current.extra; }",
      },
    ],
    [
      "direct eval",
      {
        helper:
          "function compare(previous, current) { return current.id && eval('arguments[1].extra'); }",
      },
    ],
    [
      "erased eval declaration",
      {
        prelude: "declare const eval: (source: string) => unknown;",
        helper:
          "function compare(previous, current) { return current.id && eval('arguments[1].extra'); }",
      },
    ],
    ["reassigned declaration", { prelude: "compare = (previous, current) => current.extra;" }],
    [
      "self reassigned declaration",
      {
        helper:
          "function compare(previous, current) { compare = (previous, current) => current.extra; return current.id; }",
      },
    ],
    [
      "reassigned alias",
      {
        prelude: "let select = compare; select = (previous, current) => current.extra;",
        call: "select(previous, snapshot)",
      },
    ],
    ["optional call", { call: "compare?.(previous, snapshot)" }],
    ["spread argument", { call: "compare(...[previous], snapshot)" }],
  ])("retains the root obligation for %s", (_description, options: ArgumentSummaryOptions) => {
    const result = runArgumentSummary(options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`snapshot`");
  });

  it("declines script-global helper replacement", () => {
    const source = `
      function compare(previous, current) { return current.id; }
      globalThis.compare = (previous, current) => current.extra;
      function Panel({ id, extra, onValue }) {
        const snapshot = { id, extra };
        useEffect(() => onValue(compare({}, snapshot)), [snapshot.id, onValue]);
      }
    `;
    const parsed = parseSync("panel.js", source, { astType: "ts", sourceType: "script" });
    expect(parsed.errors).toEqual([]);
    if (!isAstNode(parsed.program)) throw new Error("Expected a parsed program");
    const result = runRuleOnParsedFixture(exhaustiveDeps, source, {
      program: parsed.program,
      errors: [],
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`snapshot`");
  });

  it("retains the missing explicit field", () => {
    const result = runArgumentSummary({
      helper: "function compare(previous, current) { return current.id && current.extra; }",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`snapshot.extra`");
  });
});
