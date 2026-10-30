import { describe, expect, it } from "vite-plus/test";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  IMPORTED_CALL_AST_READS_PER_NODE,
  IMPORTED_CALL_PROOF_COUNTS,
  IMPORTED_CALL_REFERENCE_PASSES,
} from "../../../test-utils/imported-call-proof/constants.js";
import { containsImportedValueCall } from "../../utils/contains-imported-value-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

describe("imported call cold proof work", () => {
  for (const directImport of [true, false]) {
    for (const count of IMPORTED_CALL_PROOF_COUNTS) {
      it(`${count} initializers sharing ${directImport ? "an import" : "a readonly alias chain"}`, () => {
        const aliases = directImport
          ? ""
          : Array.from(
              { length: count },
              (_, index) =>
                `const ${index === count - 1 ? "selectedReader" : `reader${index}`}=${index === 0 ? "readSnapshot" : `reader${index - 1}`};`,
            ).join("");
        const callee = directImport ? "readSnapshot" : "selectedReader";
        const declarations = Array.from(
          { length: count },
          (_, index) => `const options${index}={label:${callee}()};`,
        ).join("");
        const returned = Array.from({ length: count }, (_, index) => `options${index}`).join(",");
        const code = `import{useState}from'react';import readSnapshot from'./state-reader';${aliases}export const useSettings=()=>{const[enabled]=useState(true);${declarations}return{${returned},enabled}};`;
        const rejectedCode = directImport
          ? code.replace(
              "import readSnapshot from'./state-reader';",
              "const readSnapshot=()=> 'fixed';",
            )
          : code.replace("const selectedReader=", "let selectedReader=");
        const parsed = parseFixture(code);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const nodes: EsTreeNode[] = [];
        const initializers: EsTreeNode[] = [];
        const symbols = new Set<SymbolDescriptor>();
        walkAst(parsed.program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "VariableDeclarator") &&
            isNodeOfType(node.id, "Identifier") &&
            node.id.name.startsWith("options") &&
            node.init
          )
            initializers.push(node.init);
          if (isNodeOfType(node, "Identifier")) {
            const symbol = scopes.symbolFor(node);
            if (symbol) symbols.add(symbol);
          }
        });
        let referenceVisits = 0;
        let referenceCount = 0;
        let astTypeReads = 0;
        for (const symbol of symbols) {
          const references = symbol.references;
          referenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            configurable: true,
            value: new Proxy(references, {
              get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits++;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
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
        expect(
          initializers.map((initializer) => containsImportedValueCall(initializer, scopes)),
        ).toEqual(Array.from({ length: count }, () => true));
        expect(referenceVisits).toBeLessThanOrEqual(
          referenceCount * IMPORTED_CALL_REFERENCE_PASSES,
        );
        expect(astTypeReads).toBeLessThanOrEqual(nodes.length * IMPORTED_CALL_AST_READS_PER_NODE);
        const options = { filename: "src/imported-call-work.tsx", includeLocations: true };
        const actual = runRule(preferModuleScopeStaticValue, code, options);
        const rejected = runRule(preferModuleScopeStaticValue, rejectedCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
