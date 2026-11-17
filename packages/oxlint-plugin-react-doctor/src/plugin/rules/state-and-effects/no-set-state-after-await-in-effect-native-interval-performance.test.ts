import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  INTERVAL_PROOF_COUNTS,
  INTERVAL_PROOF_PROGRAM_BODY_LIMIT,
  INTERVAL_PROOF_PROVIDER_REFERENCE_PASSES,
  INTERVAL_PROOF_DISPATCHER_REFERENCE_PASSES,
  INTERVAL_PROOF_SCOPE_SYMBOL_PASSES,
  INTERVAL_PROOF_AST_READS_PER_NODE,
} from "../../../test-utils/native-interval-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";
import { getNativeIntervalEffectCallback } from "./utils/get-native-interval-effect-callback.js";
import { INTERVAL_CALLBACK_ARGUMENT_INDEX } from "./utils/native-interval-effect/constants.js";

describe("native interval cold proof work", () => {
  for (const sharedDispatcher of [true, false]) {
    for (const count of INTERVAL_PROOF_COUNTS) {
      it(`${count} intervals with ${sharedDispatcher ? "one" : "distinct"} state dispatchers`, () => {
        const declarations = sharedDispatcher
          ? 'const [value,setValue]=useState("");'
          : Array.from(
              { length: count },
              (_, index) => `const [value${index},setValue${index}]=useState("");`,
            ).join("\n");
        const effects = Array.from(
          { length: count },
          (_, index) =>
            `useEffect(()=>{const interval=setInterval(async()=>{const first=await load(revision);const second=await load(first);setValue${sharedDispatcher ? "" : index}(second);},5000);return()=>clearInterval(interval);},[revision]);`,
        ).join("\n");
        const code = `import {useEffect,useState} from 'react';export const Panel=({revision,load})=>{${declarations}\n${effects}\nreturn <output/>;};`;
        const rejectedCode = code.replace(
          "export const Panel=",
          "const setInterval=(callback,delay)=>1;export const Panel=",
        );
        const parsed = parseFixture(code);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const cfg = analyzeControlFlow(parsed.program);
        const nodes: EsTreeNode[] = [];
        const effectCalls: EsTreeNodeOfType<"CallExpression">[] = [];
        walkAst(parsed.program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "useEffect"
          )
            effectCalls.push(node);
        });
        let programBodyReads = 0;
        let providerReferenceVisits = 0;
        let dispatcherReferenceVisits = 0;
        let scopeSymbolVisits = 0;
        let astTypeReads = 0;
        const pendingScopes = [scopes.rootScope];
        while (pendingScopes.length > 0) {
          const scope = pendingScopes.pop();
          if (!scope) break;
          pendingScopes.push(...scope.children);
          for (const symbol of scope.symbols) {
            const references = symbol.references;
            Object.defineProperty(symbol, "references", {
              configurable: true,
              value: new Proxy(references, {
                get(target, property, receiver) {
                  if (typeof property === "string" && /^\d+$/.test(property)) {
                    if (symbol.name === "useState" || symbol.name === "useEffect")
                      providerReferenceVisits++;
                    if (symbol.name.startsWith("setValue")) dispatcherReferenceVisits++;
                  }
                  return Reflect.get(target, property, receiver);
                },
              }),
            });
          }
          const symbols = scope.symbols;
          Object.defineProperty(scope, "symbols", {
            configurable: true,
            value: new Proxy(symbols, {
              get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property)) scopeSymbolVisits++;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        const body = parsed.program.body;
        Object.defineProperty(parsed.program, "body", {
          configurable: true,
          enumerable: true,
          get: () => {
            programBodyReads++;
            return body;
          },
        });
        for (const node of nodes) {
          const nodeType = node.type;
          Object.defineProperty(node, "type", {
            configurable: true,
            enumerable: true,
            get: () => {
              astTypeReads++;
              return nodeType;
            },
          });
        }
        const context: RuleContext = {
          scopes,
          cfg,
          report: () => undefined,
          filename: "/synthetic/native-interval-work/panel.tsx",
          settings: {
            "react-doctor": {
              portedRuleMode: "curated",
              reactVersion: "18.3.1",
              reactMajorVersion: 18,
              framework: "unknown",
              capabilities: ["react"],
            },
          },
          sourceCode: { ast: parsed.program, getText: () => code },
        };
        expect(parsed.errors).toEqual([]);
        expect(effectCalls).toHaveLength(count);
        expect(
          effectCalls.map((effectCall) => {
            const callback = effectCall.arguments[INTERVAL_CALLBACK_ARGUMENT_INDEX];
            if (!callback) throw new Error("Expected effect callback");
            return Boolean(getNativeIntervalEffectCallback(effectCall, callback, context));
          }),
        ).toEqual(Array.from({ length: count }, () => true));
        expect(programBodyReads).toBeLessThanOrEqual(INTERVAL_PROOF_PROGRAM_BODY_LIMIT);
        expect(providerReferenceVisits).toBeLessThanOrEqual(
          count * INTERVAL_PROOF_PROVIDER_REFERENCE_PASSES,
        );
        expect(dispatcherReferenceVisits).toBeLessThanOrEqual(
          count * INTERVAL_PROOF_DISPATCHER_REFERENCE_PASSES,
        );
        expect(scopeSymbolVisits).toBeLessThanOrEqual(count * INTERVAL_PROOF_SCOPE_SYMBOL_PASSES);
        expect(astTypeReads).toBeLessThanOrEqual(nodes.length * INTERVAL_PROOF_AST_READS_PER_NODE);
        const options = {
          filename: context.filename,
          forceJsx: true,
          includeLocations: true,
          settings: context.settings,
        };
        const actual = runRule(noSetStateAfterAwaitInEffect, code, options);
        const rejected = runRule(noSetStateAfterAwaitInEffect, rejectedCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(count);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(0);
      });
    }
  }
});
