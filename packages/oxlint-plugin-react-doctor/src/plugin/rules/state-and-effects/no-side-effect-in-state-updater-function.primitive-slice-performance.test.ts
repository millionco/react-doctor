import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";
import { isPrimitiveArraySliceCopyWrite } from "./utils/is-primitive-array-slice-copy-write.js";

for (const count of [20, 100]) {
  describe(`primitive slice proof work with ${count} consumers`, () => {
    for (const shape of ["distinct-state-pairs", "same-state-observations", "imported-producer"]) {
      it(`indexes ${shape} without repeated reference scans`, () => {
        const states = Array.from(
          { length: shape === "distinct-state-pairs" ? count : 1 },
          (_, index) => {
            const initializer =
              shape === "distinct-state-pairs"
                ? 'previous.slice(0,1);copy[0]="updated"'
                : "previous.slice(0,position);copy[position]=label";
            const producerWrites =
              shape === "imported-producer"
                ? `setEntries${index}(loadEntries());`.repeat(count)
                : "";
            return `const[entries${index},setEntries${index}]=useState<string[]>([]);${producerWrites}setEntries${index}(previous=>{const copy=${initializer};return copy;});`;
          },
        ).join("");
        const observations =
          shape === "same-state-observations" ? "void entries0[position];".repeat(count) : "";
        const producerImport =
          shape === "imported-producer" ? 'import{loadEntries}from"./entry-data";' : "";
        const code = `${producerImport}import{useState}from"react";export const Example=(position:number,label:string)=>{${states}${observations}return <output>{entries0[0]}</output>;};`;
        const parsed = parseFixture(code);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Missing synthetic program");
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const cfg = analyzeControlFlow(parsed.program);
        const writes: EsTreeNodeOfType<"AssignmentExpression">[] = [];
        const trackedSymbols = new Set<SymbolDescriptor>();
        let trackedName = "loadEntries";
        if (shape === "distinct-state-pairs") trackedName = "useState";
        else if (shape === "same-state-observations") trackedName = "position";
        walkAst(parsed.program, (node) => {
          if (
            isNodeOfType(node, "AssignmentExpression") &&
            isNodeOfType(node.left, "MemberExpression") &&
            isNodeOfType(node.left.object, "Identifier") &&
            node.left.object.name === "copy"
          )
            writes.push(node);
          if (isNodeOfType(node, "Identifier") && node.name === trackedName) {
            const symbol = scopes.symbolFor(node);
            if (symbol) trackedSymbols.add(symbol);
          }
        });
        let referenceVisits = 0;
        for (const symbol of trackedSymbols) {
          Object.defineProperty(symbol, "references", {
            value: new Proxy(symbol.references, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        let programBodyReads = 0;
        const body = parsed.program.body;
        Object.defineProperty(parsed.program, "body", {
          enumerable: true,
          get: () => {
            programBodyReads += 1;
            return body;
          },
        });
        expect(writes).toHaveLength(shape === "distinct-state-pairs" ? count : 1);
        expect(trackedSymbols.size).toBe(1);
        for (const write of writes) {
          const updater = write.parent?.parent?.parent;
          const setterCall = updater?.parent;
          if (
            !isNodeOfType(updater, "ArrowFunctionExpression") ||
            !isNodeOfType(setterCall, "CallExpression")
          )
            throw new Error("Missing synthetic slice updater");
          expect(
            isPrimitiveArraySliceCopyWrite(write, updater, setterCall, {
              scopes,
              cfg,
              report: () => undefined,
            }),
          ).toBe(true);
        }
        expect(parsed.errors).toEqual([]);
        expect(programBodyReads).toBeLessThanOrEqual(2);
        expect(referenceVisits).toBeLessThanOrEqual(count * 2 + 2);
        expect(runRule(noSideEffectInStateUpdaterFunction, code).diagnostics).toHaveLength(0);
        const replacement = `Array.prototype.slice=replacement;${code}`;
        const rejected = runRule(noSideEffectInStateUpdaterFunction, replacement);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(shape === "distinct-state-pairs" ? count : 1);
      });
    }
  });
}
