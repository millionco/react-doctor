import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  CALLBACK_MAP_SNAPSHOT_PROOF_COUNTS,
  MAX_CALLBACK_MAP_PROVIDER_REFERENCE_PASSES,
} from "../../../test-utils/callback-map-snapshot-proof/constants.js";
import {
  MAX_GUARDED_MAP_PROGRAM_BODY_READS,
  MAX_GUARDED_MAP_AST_TYPE_READS_PER_NODE,
} from "../../../test-utils/guarded-callback-map-proof/constants.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";
import { hasOwnedGuardedCallbackMapReturn } from "./utils/has-owned-guarded-callback-map-return.js";

describe("guarded callback Map cold proof work", () => {
  for (const separateComponents of [false, true]) {
    for (const count of CALLBACK_MAP_SNAPSHOT_PROOF_COUNTS) {
      it(`${count} guarded callbacks in ${separateComponents ? "separate components" : "one component"} construct context-specific proofs once`, () => {
        const declarations = Array.from(
          { length: count },
          (_, index) =>
            `const entries${index}=React.useRef<Map<string,HTMLLIElement>>(new Map()); useBrowserEffect(()=>{entries${index}.current.get("entry")?.focus();},[]);`,
        );
        const children = Array.from(
          { length: count },
          (_, index) =>
            `<li ref={(element)=>{if(element){entries${index}.current.set("entry",element);return ()=>{if(entries${index}.current.get("entry")===element)entries${index}.current.delete("entry");};}else{entries${index}.current.delete("entry");}}}>Entry</li>`,
        );
        const source =
          'import * as React from "react";\nconst useBrowserEffect=typeof window === "undefined"?React.useEffect:React.useLayoutEffect;\n' +
          (separateComponents
            ? declarations
                .map(
                  (declaration, index) =>
                    `export const EntryPanel${index}=()=>{${declaration}return ${children[index]};};`,
                )
                .join("\n")
            : `export const EntryPanel=()=>{${declarations.join("\n")}return <>${children.join("\n")}</>;};`);
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a Program");
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const nodes: EsTreeNode[] = [];
        const attributes: EsTreeNode[] = [];
        walkAst(program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "JSXAttribute") &&
            isNodeOfType(node.name, "JSXIdentifier") &&
            node.name.name === "ref"
          )
            attributes.push(node);
        });
        expect(attributes).toHaveLength(count);
        let providerReferenceVisits = 0;
        let providerReferenceCount = 0;
        let programBodyReads = 0;
        let astTypeReads = 0;
        for (const symbol of scopes.rootScope.symbols) {
          if (symbol.kind !== "import") continue;
          const references = symbol.references;
          providerReferenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            value: new Proxy(references, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property))
                  providerReferenceVisits += 1;
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
        for (const node of nodes) {
          const nodeType = node.type;
          Object.defineProperty(node, "type", {
            enumerable: true,
            get: () => {
              astTypeReads += 1;
              return nodeType;
            },
          });
        }
        expect(
          attributes.every((attribute) => hasOwnedGuardedCallbackMapReturn({ attribute, scopes })),
        ).toBe(true);
        expect(programBodyReads).toBeLessThanOrEqual(MAX_GUARDED_MAP_PROGRAM_BODY_READS);
        expect(providerReferenceVisits).toBeLessThanOrEqual(
          providerReferenceCount * MAX_CALLBACK_MAP_PROVIDER_REFERENCE_PASSES,
        );
        expect(astTypeReads).toBeLessThanOrEqual(
          nodes.length * MAX_GUARDED_MAP_AST_TYPE_READS_PER_NODE,
        );
        const options = {
          filename: "/synthetic/guarded-map-proof/entry.tsx",
          settings: {
            "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
          },
        };
        const actual = runRule(noRefCallbackCleanupBeforeReact19, source, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toEqual([]);
        const rejected = runRule(
          noRefCallbackCleanupBeforeReact19,
          source.replace(
            /else\{(entries\d+\.current\.delete)\("entry"\);\}/g,
            'else{$1("other");}',
          ),
          options,
        );
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
