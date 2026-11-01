import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { runRule } from "../../test-utils/run-rule.js";
import {
  BOOLEAN_INPUT_PROOF_COUNTS,
  MAX_BOOLEAN_INPUT_PROGRAM_BODY_READS,
  MAX_BOOLEAN_INPUT_REFERENCE_PASSES,
} from "../../test-utils/finite-boolean-proof/constants.js";
import { noSetStateAfterAwaitInEffect } from "../rules/state-and-effects/no-set-state-after-await-in-effect.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFiniteEffectCallbackBooleanInput } from "./is-finite-effect-callback-boolean-input.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

describe("finite Boolean input cold proof work", () => {
  for (const shape of ["shared-awaited-input", "distinct-awaited-inputs-shared-import"]) {
    for (const count of BOOLEAN_INPUT_PROOF_COUNTS) {
      it(`${shape} at ${count} guards reuses immutable reference proofs`, () => {
        const imported = shape === "distinct-awaited-inputs-shared-import";
        const guards = Array.from({ length: count }, (_, index) =>
          imported
            ? `const received${index}=await readValue(query);if(received${index})setValue(query);`
            : "if(received)setValue(query);",
        ).join("");
        const source = `import{useCallback,useEffect,useState}from'react';${imported ? "import{readValue}from'./opaque-provider';" : ""}export const FocusPanel=({query${imported ? "" : ",readValue"}}:{query:string;${imported ? "" : "readValue:(query:string)=>Promise<string>;"}})=>{const[value,setValue]=useState('');const run=useCallback(async()=>{${imported ? "" : "const received=await readValue(query);"}${guards}},[query]);useEffect(()=>{if(document.hasFocus())run()},[query,run]);return <output>{value}</output>};`;
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a program");
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const guardsToCheck: EsTreeNode[] = [];
        const symbols = new Set<ReturnType<typeof scopes.symbolFor>>();
        walkAst(program, (node) => {
          if (isNodeOfType(node, "IfStatement") && isNodeOfType(node.test, "Identifier"))
            guardsToCheck.push(node.test);
          if (isNodeOfType(node, "Identifier")) symbols.add(scopes.symbolFor(node));
        });
        let referenceCount = 0;
        let referenceVisits = 0;
        for (const symbol of symbols) {
          if (!symbol || (symbol.name !== "readValue" && !symbol.name.startsWith("received")))
            continue;
          const references = symbol.references;
          referenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            configurable: true,
            value: new Proxy(references, {
              get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        let programBodyReads = 0;
        const programBody = program.body;
        Object.defineProperty(program, "body", {
          configurable: true,
          enumerable: true,
          get() {
            programBodyReads += 1;
            return programBody;
          },
        });
        const filename = `/synthetic/finite-boolean-work/${shape}-${count}.tsx`;
        const settings = { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } };
        const context: RuleContext = {
          filename,
          scopes,
          get cfg() {
            return analyzeControlFlow(program);
          },
          settings,
          sourceCode: { ast: program, getText: () => source },
          report: () => {},
        };
        expect(guardsToCheck).toHaveLength(count);
        expect(
          guardsToCheck.every((guard) => isFiniteEffectCallbackBooleanInput(guard, context)),
        ).toBe(true);
        expect(referenceVisits).toBeLessThanOrEqual(
          referenceCount * MAX_BOOLEAN_INPUT_REFERENCE_PASSES,
        );
        expect(programBodyReads).toBeLessThanOrEqual(MAX_BOOLEAN_INPUT_PROGRAM_BODY_READS);
        const actual = runRule(noSetStateAfterAwaitInEffect, source, { filename, settings });
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(1);
        const escaped = runRule(
          noSetStateAfterAwaitInEffect,
          source.replace("const run=useCallback", "consume(readValue);const run=useCallback"),
          { filename, settings },
        );
        expect(escaped.parseErrors).toEqual([]);
        expect(escaped.diagnostics).toEqual([]);
      });
    }
  }
});
