import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isOwnedRequestMapReset } from "../rules/state-and-effects/utils/is-owned-request-map-reset.js";
import { runRule } from "../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "../rules/state-and-effects/no-adjust-state-on-prop-change.js";

const REQUEST_MAP_CONTEXT_CASES = [
  {
    name: "current-reset-dominance",
    code: '\n        import { useEffect, useRef, useState } from "react";\n        const Requests = ({ query }) => {\n          const pending = useRef(new Map());\n          const [loading, setLoading] = useState(new Set());\n          const [draft, setDraft] = useState(new Set());\n          \n          const start = (requestKey, otherKey) => {\n            const controller = new AbortController();\n            pending.current.set(requestKey, { controller });\n            setLoading((previous) => new Set(previous).add(requestKey));\n            \n          };\n          useEffect(() => {\n            setLoading(new Set());\n            pending.current.forEach((entry) => entry.controller.abort());\n            pending.current.clear();\n            setLoading(new Set());\n          }, [query]);\n          return <button onClick={() => start("item", "other")}>{loading.size + draft.size}</button>;\n        };\n      ',
    expected: [false, true],
    diagnostics: [
      {
        column: 12,
        line: 15,
        message:
          "Updating state in an effect after a prop changes can trigger another render and show stale values.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "current-selected-setter",
    code: '\n        import { useEffect, useRef, useState } from "react";\n        const Requests = ({ query }) => {\n          const pending = useRef(new Map());\n          const [loading, setLoading] = useState(new Set());\n          const [draft, setDraft] = useState(new Set());\n          \n          const start = (requestKey, otherKey) => {\n            const controller = new AbortController();\n            pending.current.set(requestKey, { controller });\n            setLoading((previous) => new Set(previous).add(requestKey));\n            \n          };\n          useEffect(() => {\n            pending.current.forEach((entry) => entry.controller.abort());\n            pending.current.clear();\n            setLoading(new Set());\n            setDraft(new Set());\n          }, [query]);\n          return <button onClick={() => start("item", "other")}>{loading.size + draft.size}</button>;\n        };\n      ',
    expected: [true, false],
    diagnostics: [
      {
        column: 12,
        line: 18,
        message:
          "Updating state in an effect after a prop changes can trigger another render and show stale values.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("request-map reset context", () => {
  it.each(REQUEST_MAP_CONTEXT_CASES)("$name", ({ code, expected, diagnostics }) => {
    const parsed = parseFixture(code);
    attachParentReferences(parsed.program);
    const writes: EsTreeNode[] = [];
    walkAst(parsed.program, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        ["setLoading", "setDraft"].includes(node.callee.name) &&
        node.arguments[0]?.type === "NewExpression"
      )
        writes.push(node);
    });
    expect(parsed.errors).toEqual([]);
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const scopes = analyzeScopes(parsed.program),
        cfg = analyzeControlFlow(parsed.program),
        context = {
          scopes,
          cfg,
          settings: { "react-doctor": { portedRuleMode: "curated" } },
          sourceCode: { ast: parsed.program, getText: () => code },
          report: () => {},
        };
      for (const selected of [...order, ...order, ...order.toReversed()]) {
        const write = writes[selected];
        if (!write) throw Error("Expected reset");
        expect(isOwnedRequestMapReset(write, context)).toBe(expected[selected]);
      }
    }
    const actual = runRule(noAdjustStateOnPropChange, code, { includeLocations: true });
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual(diagnostics);
  });
});
