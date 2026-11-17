import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes, type SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  NATIVE_KEYS_AST_READS_PER_NODE,
  NATIVE_KEYS_COLD_PROOF_COUNTS,
  NATIVE_KEYS_INPUT_REFERENCE_PASSES,
  NATIVE_KEYS_PROGRAM_BODY_READ_LIMIT,
} from "../../../test-utils/native-keys-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNativeObjectKeysIterationReceiver } from "../../utils/is-native-object-keys-iteration-receiver.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

describe("native Object.keys iteration cold work", () => {
  for (const sharedInput of [true, false]) {
    for (const count of NATIVE_KEYS_COLD_PROOF_COUNTS) {
      it(`${count} memberships with ${sharedInput ? "one" : "distinct"} outer inputs`, () => {
        const code = sharedInput
          ? `export const select=(rows,shared)=>rows.map(row=>[${Array.from({ length: count }, (_, index) => `Object.keys(row).includes("selected${index}")`).join(",")}]);`
          : `export const select=(rows,shared)=>[${Array.from({ length: count }, (_, index) => `rows.map(row${index}=>Object.keys(row${index}).includes("selected"))`).join(",")}];`;
        const rejectedCode = code.replace(/Object\.keys\(row\d*\)/g, "Object.keys(shared)");
        const parsed = parseFixture(code);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const nodes: EsTreeNode[] = [];
        const receivers: EsTreeNode[] = [];
        const inputs = new Set<SymbolDescriptor>();
        walkAst(parsed.program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "MemberExpression") &&
            isNodeOfType(node.callee.object, "Identifier") &&
            node.callee.object.name === "Object" &&
            isNodeOfType(node.callee.property, "Identifier") &&
            node.callee.property.name === "keys"
          ) {
            receivers.push(node);
            const argument = node.arguments[0];
            const input = argument ? scopes.symbolFor(argument) : null;
            if (input) inputs.add(input);
          }
        });
        let inputReferenceVisits = 0;
        let inputReferenceCount = 0;
        let programBodyReads = 0;
        let astTypeReads = 0;
        for (const input of inputs) {
          const references = input.references;
          inputReferenceCount += references.length;
          Object.defineProperty(input, "references", {
            configurable: true,
            value: new Proxy(references, {
              get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property)) inputReferenceVisits++;
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
        expect(parsed.errors).toEqual([]);
        expect(receivers).toHaveLength(count);
        expect(
          receivers.map((receiver) => isNativeObjectKeysIterationReceiver(receiver, scopes)),
        ).toEqual(Array.from({ length: count }, () => true));
        expect(inputReferenceVisits).toBeLessThanOrEqual(
          inputReferenceCount * NATIVE_KEYS_INPUT_REFERENCE_PASSES,
        );
        expect(programBodyReads).toBeLessThanOrEqual(NATIVE_KEYS_PROGRAM_BODY_READ_LIMIT);
        expect(astTypeReads).toBeLessThanOrEqual(nodes.length * NATIVE_KEYS_AST_READS_PER_NODE);
        const options = {
          filename: "/synthetic/native-keys-work/lookup.ts",
          includeLocations: true,
        };
        const actual = runRule(jsSetMapLookups, code, options);
        const rejected = runRule(jsSetMapLookups, rejectedCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
