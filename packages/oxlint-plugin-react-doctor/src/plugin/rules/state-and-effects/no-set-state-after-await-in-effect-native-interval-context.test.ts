import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  INTERVAL_PROOF_CONTEXT_ORDERS,
  INTERVAL_PROOF_PROTECTED_NAME_WARNING_LINE,
  INTERVAL_PROOF_OWNER_WARNING_LINE,
  INTERVAL_PROOF_CONTEXT_WARNING_COUNT,
} from "../../../test-utils/native-interval-proof/constants.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";
import { getNativeIntervalEffectCallback } from "./utils/get-native-interval-effect-callback.js";
import { INTERVAL_CALLBACK_ARGUMENT_INDEX } from "./utils/native-interval-effect/constants.js";

interface IntervalProofContextCase {
  name: string;
  code: string;
  expectedAdmissions: boolean[];
  warningLine: number;
}

const cases: IntervalProofContextCase[] = [
  {
    name: "current protected names",
    code: "import {useEffect,useState} from 'react';\ninterface firstInterval {}\nexport const Panel=({revision,load})=>{\nconst [value,setValue]=useState('');\nuseEffect(()=>{const firstInterval=setInterval(async()=>{const result=await load(revision);setValue(result);},5000);return()=>clearInterval(firstInterval);},[revision]);\nuseEffect(()=>{const secondInterval=setInterval(async()=>{const result=await load(revision);setValue(result);},5000);return()=>clearInterval(secondInterval);},[revision]);\nreturn <output/>;};",
    expectedAdmissions: [false, true],
    warningLine: INTERVAL_PROOF_PROTECTED_NAME_WARNING_LINE,
  },
  {
    name: "current dispatcher owner",
    code: "import {useEffect,useState} from 'react';\nexport const Panel=({revision,load})=>{\nconst [value,setValue]=useState('');\nuseEffect(()=>{const interval=setInterval(async()=>{const result=await load(revision);setValue(result);},5000);return()=>clearInterval(interval);},[revision]);\nconst nested=()=>{\nuseEffect(()=>{const interval=setInterval(async()=>{const result=await load(revision);setValue(result);},5000);return()=>clearInterval(interval);},[revision]);\n};\nreturn <output/>;};",
    expectedAdmissions: [true, false],
    warningLine: INTERVAL_PROOF_OWNER_WARNING_LINE,
  },
];

describe("native interval cache context boundaries", () => {
  for (const scenario of cases) {
    for (const order of INTERVAL_PROOF_CONTEXT_ORDERS) {
      it(`${scenario.name} in initial order ${order.join(",")}`, () => {
        const parsed = parseFixture(scenario.code);
        attachParentReferences(parsed.program);
        const analyses = [analyzeScopes(parsed.program), analyzeScopes(parsed.program)];
        const cfg = analyzeControlFlow(parsed.program);
        const effectCalls: EsTreeNodeOfType<"CallExpression">[] = [];
        walkAst(parsed.program, (node) => {
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "useEffect"
          )
            effectCalls.push(node);
        });
        for (const scopes of analyses) {
          const context: RuleContext = {
            scopes,
            cfg,
            report: () => undefined,
            filename: "/synthetic/native-interval-context/panel.tsx",
            settings: {
              "react-doctor": {
                portedRuleMode: "curated",
                reactVersion: "18.3.1",
                reactMajorVersion: 18,
                framework: "unknown",
                capabilities: ["react"],
              },
            },
            sourceCode: { ast: parsed.program, getText: () => scenario.code },
          };
          const sequence = [...order, ...order, ...order.toReversed()];
          expect(parsed.errors).toEqual([]);
          expect(effectCalls).toHaveLength(scenario.expectedAdmissions.length);
          expect(
            sequence.map((index) => {
              const effectCall = effectCalls[index];
              const callback = effectCall?.arguments[INTERVAL_CALLBACK_ARGUMENT_INDEX];
              if (!effectCall || !callback) throw new Error("Expected effect callback");
              return Boolean(getNativeIntervalEffectCallback(effectCall, callback, context));
            }),
          ).toEqual(sequence.map((index) => scenario.expectedAdmissions[index]));
          const actual = runRule(noSetStateAfterAwaitInEffect, scenario.code, {
            filename: context.filename,
            forceJsx: true,
            includeLocations: true,
            settings: context.settings,
          });
          expect(actual.parseErrors).toEqual([]);
          expect(actual.diagnostics).toHaveLength(INTERVAL_PROOF_CONTEXT_WARNING_COUNT);
          expect(actual.diagnostics.map(({ line, column }) => ({ line, column }))).toEqual([
            { line: scenario.warningLine, column: INTERVAL_CALLBACK_ARGUMENT_INDEX },
          ]);
        }
      });
    }
  }
});
