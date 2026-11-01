import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes, type SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  PRIVATE_LATCH_AST_READS_PER_NODE,
  PRIVATE_LATCH_COLD_PROOF_COUNTS,
  PRIVATE_LATCH_PARENT_READS_PER_NODE,
  PRIVATE_LATCH_PROGRAM_BODY_READ_LIMIT,
  PRIVATE_LATCH_REFERENCE_VISITS_PER_WRITE,
} from "../../../test-utils/private-latch-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { isPrivateInitializationLatchWrite } from "./utils/is-private-initialization-latch-write.js";

describe("private initialization latch cold proof work", () => {
  for (const oneOwner of [true, false]) {
    for (const count of PRIVATE_LATCH_COLD_PROOF_COUNTS) {
      it(`${count} latches with ${oneOwner ? "one" : "separate"} owners`, () => {
        const bodies = Array.from(
          { length: count },
          (_, index) =>
            `const [latch${index},setLatch${index}]=React.useState(true);React.useEffect(()=>{if(latch${index}){setLatch${index}(false);}},[revision]);`,
        );
        const code =
          'import * as React from "react";' +
          (oneOwner
            ? `export const useSetup=({revision})=>{${bodies.join("")}};`
            : bodies
                .map((body, index) => `export const useSetup${index}=({revision})=>{${body}};`)
                .join(""));
        const rejectedCode = oneOwner
          ? code.replace("};", "return latch0;};")
          : code.replaceAll(
              /(export const useSetup(\d+)=\(\{revision\}\)=>\{[\s\S]*?)(\};)/g,
              (_match, body, index, end) => body + `return latch${index};` + end,
            );
        const parsed = parseFixture(code);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const cfg = analyzeControlFlow(parsed.program);
        const nodes: EsTreeNode[] = [];
        const writes: EsTreeNode[] = [];
        const symbols = new Set<SymbolDescriptor>();
        walkAst(parsed.program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name.startsWith("setLatch")
          )
            writes.push(node);
          if (isNodeOfType(node, "Identifier")) {
            const symbol = scopes.symbolFor(node);
            if (symbol) symbols.add(symbol);
          }
        });
        let referenceVisits = 0;
        let programBodyReads = 0;
        let astTypeReads = 0;
        let parentReads = 0;
        for (const symbol of symbols)
          Object.defineProperty(symbol, "references", {
            configurable: true,
            value: new Proxy(symbol.references, {
              get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits++;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
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
          const parent = node.parent;
          Object.defineProperty(node, "type", {
            configurable: true,
            enumerable: true,
            get: () => {
              astTypeReads++;
              return nodeType;
            },
          });
          Object.defineProperty(node, "parent", {
            configurable: true,
            enumerable: false,
            get: () => {
              parentReads++;
              return parent;
            },
          });
        }
        const settings = {
          "react-doctor": {
            portedRuleMode: "curated",
            capabilities: ["react"],
            reactVersion: "18.3.1",
            reactMajorVersion: 18,
          },
        };
        const context = {
          scopes,
          cfg,
          settings,
          sourceCode: { ast: parsed.program, getText: () => code },
          report: () => {},
        };
        expect(parsed.errors).toEqual([]);
        expect(writes).toHaveLength(count);
        expect(writes.map((write) => isPrivateInitializationLatchWrite(write, context))).toEqual(
          Array.from({ length: count }, () => true),
        );
        expect(programBodyReads).toBeLessThanOrEqual(PRIVATE_LATCH_PROGRAM_BODY_READ_LIMIT);
        expect(referenceVisits).toBeLessThanOrEqual(
          count * PRIVATE_LATCH_REFERENCE_VISITS_PER_WRITE,
        );
        expect(astTypeReads).toBeLessThanOrEqual(nodes.length * PRIVATE_LATCH_AST_READS_PER_NODE);
        expect(parentReads).toBeLessThanOrEqual(nodes.length * PRIVATE_LATCH_PARENT_READS_PER_NODE);
        const options = {
          filename: "/synthetic/private-latch-work/fixture.tsx",
          settings,
          includeLocations: true,
        };
        const actual = runRule(noAdjustStateOnPropChange, code, options);
        const rejected = runRule(noAdjustStateOnPropChange, rejectedCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
