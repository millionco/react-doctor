import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import {
  BOOLEAN_INPUT_CACHE_VISIT_ORDERS,
  BOOLEAN_INPUT_CACHE_EXPECTED_RESULTS,
} from "../../test-utils/finite-boolean-proof/constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFiniteEffectCallbackBooleanInput } from "./is-finite-effect-callback-boolean-input.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

const source =
  "import{useCallback,useEffect}from'react';export const FocusPanel=({query,readValue}:{query:string;readValue:(query:string)=>Promise<string>})=>{const run=useCallback(async()=>{if(received){}const received=await readValue(query);if(received){}const nested=async()=>{if(received){}const nestedReceived=await readValue(query);if(nestedReceived){}};},[query]);useEffect(()=>{if(document.hasFocus())run()},[query,run]);return null};";

describe("finite Boolean input occurrence cache boundaries", () => {
  for (const order of BOOLEAN_INPUT_CACHE_VISIT_ORDERS) {
    it(`retains order and callback owner checks for visit order ${order.join(",")}`, () => {
      const parsed = parseFixture(source);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const predicates: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "IfStatement") && isNodeOfType(node.test, "Identifier"))
          predicates.push(node.test);
      });
      expect(predicates).toHaveLength(BOOLEAN_INPUT_CACHE_EXPECTED_RESULTS.length);
      const context: RuleContext = {
        filename: "/synthetic/finite-boolean-cache-boundary.tsx",
        scopes,
        get cfg() {
          return analyzeControlFlow(parsed.program);
        },
        sourceCode: { ast: parsed.program, getText: () => source },
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        report: () => {},
      };
      for (const index of order) {
        const predicate = predicates[index];
        if (!predicate) throw new Error("Expected a predicate");
        expect(isFiniteEffectCallbackBooleanInput(predicate, context)).toBe(
          BOOLEAN_INPUT_CACHE_EXPECTED_RESULTS[index],
        );
      }
    });
  }
});
