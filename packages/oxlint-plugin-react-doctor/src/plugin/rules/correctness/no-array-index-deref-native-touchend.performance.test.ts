import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes, type SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  TOUCHEND_AST_READS_PER_NODE,
  TOUCHEND_COLD_PROOF_COUNTS,
  TOUCHEND_EVENT_REFERENCE_PASSES,
  TOUCHEND_PROGRAM_BODY_READ_LIMIT,
} from "../../../test-utils/native-touchend-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNativeTouchendChangedTouchRead } from "./utils/is-native-touchend-changed-touch-read.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";
import { NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN } from "./utils/native-touchend/constants.js";

afterEach(() => vi.restoreAllMocks());

describe("native touchend coordinate cold work", () => {
  for (const sharedHandler of [true, false]) {
    for (const count of TOUCHEND_COLD_PROOF_COUNTS) {
      it(`${count} coordinate reads with ${sharedHandler ? "one" : "distinct"} native handlers`, () => {
        const code = sharedHandler
          ? `export const Screen=()=> <div onTouchEnd={event=>console.log(${Array.from({ length: count }, () => "event.changedTouches[0].clientX").join(",")})}/>;`
          : `export const Screen=()=> <>${Array.from({ length: count }, (_, index) => `<div onTouchEnd={event${index}=>console.log(event${index}.changedTouches[0].clientX)}/>`).join("")}</>;`;
        const rejectedCode = code.replaceAll(".changedTouches[0]", ".touches[0]");
        const parsed = parseFixture(code);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const cfg = analyzeControlFlow(parsed.program);
        const nodes: EsTreeNode[] = [];
        const receivers: EsTreeNode[] = [];
        const inputs = new Set<SymbolDescriptor>();
        walkAst(parsed.program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "MemberExpression") &&
            isNodeOfType(node.property, "Identifier") &&
            node.property.name === "clientX"
          ) {
            receivers.push(node);
            let eventNode: EsTreeNode = node;
            for (const propertyName of ["clientX", "0", "changedTouches"]) {
              if (!isNodeOfType(eventNode, "MemberExpression"))
                throw new Error(`Expected ${propertyName} member`);
              eventNode = eventNode.object;
            }
            const input = scopes.symbolFor(eventNode);
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
        let pragmaTextUnits = 0;
        const originalPragmaTest = NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN.test.bind(
          NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN,
        );
        vi.spyOn(NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN, "test").mockImplementation((source) => {
          pragmaTextUnits += source.length;
          return originalPragmaTest(source);
        });
        const settings = {
          "react-doctor": {
            framework: "nextjs",
            capabilities: ["nextjs", "react", "react:19"],
            portedRuleMode: "curated",
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
        expect(receivers).toHaveLength(count);
        expect(
          receivers.map((receiver) => isNativeTouchendChangedTouchRead(receiver, context)),
        ).toEqual(Array.from({ length: count }, () => true));
        expect(inputReferenceVisits).toBeLessThanOrEqual(
          inputReferenceCount * TOUCHEND_EVENT_REFERENCE_PASSES,
        );
        expect(programBodyReads).toBeLessThanOrEqual(TOUCHEND_PROGRAM_BODY_READ_LIMIT);
        expect(astTypeReads).toBeLessThanOrEqual(nodes.length * TOUCHEND_AST_READS_PER_NODE);
        expect(pragmaTextUnits).toBeLessThanOrEqual(code.length);
        vi.restoreAllMocks();
        const options = {
          filename: "/synthetic/native-touchend-work/native.tsx",
          settings,
          includeLocations: true,
        };
        const actual = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, code, options);
        const rejected = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, rejectedCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
