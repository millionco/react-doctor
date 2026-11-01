import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  CALLBACK_MAP_SNAPSHOT_PROOF_COUNTS,
  MAX_CALLBACK_MAP_PROGRAM_WALKS,
  MAX_CALLBACK_MAP_PROVIDER_REFERENCE_PASSES,
  MAX_CALLBACK_MAP_KEY_REFERENCE_PASSES,
} from "../../../test-utils/callback-map-snapshot-proof/constants.js";
import { analyzeScopes, type SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";
import { hasOwnedCallbackMapSnapshot } from "./utils/has-owned-callback-map-snapshot.js";

describe("callback Map snapshot cold proof work", () => {
  for (const sharedKey of [false, true]) {
    for (const count of CALLBACK_MAP_SNAPSHOT_PROOF_COUNTS) {
      it(`${count} callbacks with ${sharedKey ? "a shared readonly key" : "literal keys"} construct stable proofs once`, () => {
        const source =
          'import * as React from "react";\nexport const EntryPanel=(' +
          (sharedKey ? "{entryKey}:{entryKey:string}" : "") +
          ")=>{\n" +
          Array.from(
            { length: count },
            (_, index) =>
              `const entries${index}=React.useRef<Map<string,HTMLLIElement>>(new Map());`,
          ).join("\n") +
          "\nreturn <ul>" +
          Array.from({ length: count }, (_, index) => {
            const key = sharedKey ? "entryKey" : JSON.stringify(`card${index}`);
            return `<li ref={(element)=>{const snapshot=entries${index}.current;if(element)snapshot.set(${key},element);else snapshot.delete(${key});return()=>{snapshot.delete(${key});};}}>Entry</li>`;
          }).join("\n") +
          "</ul>;};";
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a program");
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const attributes: EsTreeNode[] = [];
        const keySymbols = new Set<SymbolDescriptor>();
        walkAst(program, (node) => {
          if (
            isNodeOfType(node, "JSXAttribute") &&
            isNodeOfType(node.name, "JSXIdentifier") &&
            node.name.name === "ref"
          )
            attributes.push(node);
          if (isNodeOfType(node, "Identifier") && node.name === "entryKey") {
            const symbol = scopes.symbolFor(node);
            if (symbol) keySymbols.add(symbol);
          }
        });
        expect(attributes).toHaveLength(count);
        let programBodyReads = 0;
        let providerReferenceVisits = 0;
        let providerReferenceCount = 0;
        let keyReferenceVisits = 0;
        let keyReferenceCount = 0;
        for (const symbol of scopes.rootScope.symbols) {
          if (symbol.kind !== "import") continue;
          providerReferenceCount += symbol.references.length;
          Object.defineProperty(symbol, "references", {
            value: new Proxy(symbol.references, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property))
                  providerReferenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        for (const symbol of keySymbols) {
          keyReferenceCount += symbol.references.length;
          Object.defineProperty(symbol, "references", {
            value: new Proxy(symbol.references, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property)) keyReferenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        const body = program.body;
        Object.defineProperty(program, "body", {
          enumerable: true,
          get: () => {
            programBodyReads += 1;
            return body;
          },
        });
        expect(
          attributes.every((attribute) => hasOwnedCallbackMapSnapshot({ attribute, scopes })),
        ).toBe(true);
        expect(programBodyReads).toBeLessThanOrEqual(MAX_CALLBACK_MAP_PROGRAM_WALKS);
        expect(providerReferenceVisits).toBeLessThanOrEqual(
          providerReferenceCount * MAX_CALLBACK_MAP_PROVIDER_REFERENCE_PASSES,
        );
        expect(keyReferenceVisits).toBeLessThanOrEqual(
          keyReferenceCount * MAX_CALLBACK_MAP_KEY_REFERENCE_PASSES,
        );
        const options = {
          filename: "/synthetic/callback-map-snapshot-work.tsx",
          settings: {
            "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
          },
        };
        const admitted = runRule(noRefCallbackCleanupBeforeReact19, source, options);
        expect(admitted.parseErrors).toEqual([]);
        expect(admitted.diagnostics).toEqual([]);
        const rejected = runRule(
          noRefCallbackCleanupBeforeReact19,
          source.replace(/else snapshot.delete\([^;]+\);/g, 'else snapshot.delete("wrong");'),
          options,
        );
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
