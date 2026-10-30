import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  OWNER_SNAPSHOT_PROOF_COUNTS,
  MAX_OWNER_SNAPSHOT_PROGRAM_BODY_READS,
  MAX_OWNER_SNAPSHOT_REFERENCE_PASSES,
  MAX_OWNER_SNAPSHOT_BLOCK_BODY_PASSES,
  MAX_OWNER_SNAPSHOT_AST_READS_PER_NODE,
} from "../../../test-utils/owner-snapshot-proof/constants.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReadonlyOwnerSnapshotGuardedClear } from "../../utils/is-readonly-owner-snapshot-guarded-clear.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noUnownedAsyncErrorClear } from "./no-unowned-async-error-clear.js";

describe("readonly owner snapshot cold work", () => {
  for (const sharedCallback of [true, false])
    for (const count of OWNER_SNAPSHOT_PROOF_COUNTS) {
      it(`${count} clears in ${sharedCallback ? "one callback" : "independent owners"} reuse immutable proof facts`, () => {
        const bodies = Array.from(
          { length: sharedCallback ? 1 : count },
          (_, index) =>
            `export const useDelivery${index}=(requestId:string,task:()=>Promise<void>)=>{const[error,setError]=useState(null);const latest=useRef(requestId);latest.current=requestId;const send=async()=>{const mine=requestId;await task();${Array.from({ length: sharedCallback ? count : 1 }, () => "if(latest.current===mine)setError(null);").join("")}setError({reason:'not-ready'});};return{error,send}};`,
        );
        const source = "import{useRef,useState}from'react';" + bodies.join("");
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const cfg = analyzeControlFlow(program);
        const nodes: EsTreeNode[] = [];
        const calls: EsTreeNodeOfType<"CallExpression">[] = [];
        const symbols = new Set<SymbolDescriptor>();
        walkAst(program, (node) => {
          nodes.push(node);
          if (isNodeOfType(node, "Identifier")) {
            const symbol = scopes.symbolFor(node);
            if (symbol) symbols.add(symbol);
          }
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "setError" &&
            isNodeOfType(node.arguments[0], "Literal") &&
            node.arguments[0].value === null
          )
            calls.push(node);
        });
        let referenceVisits = 0;
        let referenceCount = 0;
        let programBodyReads = 0;
        let blockBodyReads = 0;
        let blockCount = 0;
        let astTypeReads = 0;
        for (const symbol of symbols) {
          const references = symbol.references;
          referenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            value: new Proxy(references, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        for (const node of nodes) {
          if (isNodeOfType(node, "Program")) {
            const body = node.body;
            Object.defineProperty(node, "body", {
              enumerable: true,
              get: () => {
                programBodyReads += 1;
                return body;
              },
            });
          } else if (isNodeOfType(node, "BlockStatement")) {
            blockCount += 1;
            const body = node.body;
            Object.defineProperty(node, "body", {
              enumerable: true,
              get: () => {
                blockBodyReads += 1;
                return body;
              },
            });
          }
          const nodeType = node.type;
          Object.defineProperty(node, "type", {
            enumerable: true,
            get: () => {
              astTypeReads += 1;
              return nodeType;
            },
          });
        }
        const settings = { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } };
        const context = { scopes, cfg, settings, report: () => {} };
        expect(calls).toHaveLength(count);
        expect(
          calls.every((call) => {
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
        expect(programBodyReads).toBeLessThanOrEqual(MAX_OWNER_SNAPSHOT_PROGRAM_BODY_READS);
        expect(referenceVisits).toBeLessThanOrEqual(
          referenceCount * MAX_OWNER_SNAPSHOT_REFERENCE_PASSES,
        );
        expect(blockBodyReads).toBeLessThanOrEqual(
          blockCount * MAX_OWNER_SNAPSHOT_BLOCK_BODY_PASSES,
        );
        expect(astTypeReads).toBeLessThanOrEqual(
          nodes.length * MAX_OWNER_SNAPSHOT_AST_READS_PER_NODE,
        );
        const options = { filename: "/synthetic/owner-snapshot-proof/delivery.tsx", settings };
        const actual = runRule(noUnownedAsyncErrorClear, source, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toEqual([]);
        const rejected = runRule(
          noUnownedAsyncErrorClear,
          source.replaceAll("latest.current===mine", "latest.current!==mine"),
          options,
        );
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(sharedCallback ? 1 : count);
      });
    }
});
