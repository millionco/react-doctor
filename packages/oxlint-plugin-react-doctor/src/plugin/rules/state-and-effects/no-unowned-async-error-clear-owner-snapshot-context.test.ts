import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReadonlyOwnerSnapshotGuardedClear } from "../../utils/is-readonly-owner-snapshot-guarded-clear.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noUnownedAsyncErrorClear } from "./no-unowned-async-error-clear.js";

describe("readonly owner snapshot names and cache context", () => {
  for (const nameMatchFirst of [true, false]) {
    it(`preserves actual callback ownership with the inert type-name match ${nameMatchFirst ? "first" : "last"}`, () => {
      const order = nameMatchFirst ? ["A", "B"] : ["B", "A"];
      const source =
        "import{useRef,useState}from'react';\ninterface mineA {}\n" +
        order
          .map(
            (suffix) =>
              `export const useDelivery${suffix}=(requestId:string,task:()=>Promise<void>)=>{const[error,setError${suffix}]=useState(null);const latest${suffix}=useRef(requestId);latest${suffix}.current=requestId;const send=async()=>{const mine${suffix}=requestId;await task();if(latest${suffix}.current===mine${suffix})setError${suffix}(null);setError${suffix}({reason:'not-ready'});};return{error,send}};`,
          )
          .join("\n");
      const parsed = parseFixture(source);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const cfg = analyzeControlFlow(parsed.program);
      const calls: EsTreeNodeOfType<"CallExpression">[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name.startsWith("setError") &&
          isNodeOfType(node.arguments[0], "Literal") &&
          node.arguments[0].value === null
        )
          calls.push(node);
      });
      expect(calls).toHaveLength(order.length);
      const context = { scopes, cfg, report: () => {} };
      for (const selected of [calls, [...calls].reverse(), calls])
        expect(
          selected.every((call) => {
            const callback = findEnclosingFunction(call);
            const owner = callback && findEnclosingFunction(callback);
            const setter = isNodeOfType(call.callee, "Identifier")
              ? scopes.symbolFor(call.callee)
              : null;
            return Boolean(
              callback &&
              owner &&
              setter &&
              isReadonlyOwnerSnapshotGuardedClear(call, callback, owner, setter, context),
            );
          }),
        ).toBe(true);
      const actual = runRule(noUnownedAsyncErrorClear, source, {
        filename: "/synthetic/readonly-owner-context/delivery.tsx",
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(actual.parseErrors).toEqual([]);
      expect(actual.diagnostics).toEqual([]);
    });
  }
});
