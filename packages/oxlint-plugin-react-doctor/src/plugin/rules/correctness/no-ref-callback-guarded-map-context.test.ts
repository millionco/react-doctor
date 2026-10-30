import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";
import { hasOwnedGuardedCallbackMapReturn } from "./utils/has-owned-guarded-callback-map-return.js";
import { hasOwnedCallbackMapSnapshot } from "./utils/has-owned-callback-map-snapshot.js";
import { hasSupportedCallbackMapProgram } from "./utils/has-supported-callback-map-program.js";
const fixturePrefix =
  'import * as React from "react";\nconst useBrowserEffect=typeof window === "undefined"?React.useEffect:React.useLayoutEffect;\nexport const EntryPanel=()=>{\nconst guardedEntries=React.useRef<Map<string,HTMLLIElement>>(new Map());\nconst snapshotEntries=React.useRef<Map<string,HTMLLIElement>>(new Map());\nuseBrowserEffect(()=>{guardedEntries.current.get("entry")?.focus();},[]);\nreturn <>\n';
const guarded =
  '<li ref={(element)=>{if(element){guardedEntries.current.set("entry",element);return ()=>{if(guardedEntries.current.get("entry")===element)guardedEntries.current.delete("entry");};}else guardedEntries.current.delete("entry");}}>Guarded</li>';
const snapshot =
  '<li ref={(element)=>{const current=snapshotEntries.current;if(element)current.set("entry",element);else current.delete("entry");return()=>{current.delete("entry");};}}>Snapshot</li>';

describe("guarded callback Map program permission cache contexts", () => {
  it.each([true, false])(
    "keeps permitted selector and ordinary snapshot proofs separate, guarded first=%s",
    (guardedFirst) => {
      const source =
        fixturePrefix +
        (guardedFirst ? [guarded, snapshot] : [snapshot, guarded]).join("\n") +
        "\n</>;};";
      const parsed = parseFixture(source);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const attributes: EsTreeNode[] = [];
      const permissions = new Set<EsTreeNode>();
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "JSXAttribute") &&
          isNodeOfType(node.name, "JSXIdentifier") &&
          node.name.name === "ref"
        )
          attributes.push(node);
        if (
          isNodeOfType(node, "ConditionalExpression") &&
          isNodeOfType(node.test, "BinaryExpression") &&
          isNodeOfType(node.test.left, "UnaryExpression")
        ) {
          permissions.add(node.test.left.argument);
          permissions.add(node.consequent);
          permissions.add(node.alternate);
        }
      });
      const evaluate = (attribute: EsTreeNode) => ({
        guarded: hasOwnedGuardedCallbackMapReturn({ attribute, scopes }),
        snapshot: hasOwnedCallbackMapSnapshot({ attribute, scopes }),
      });
      const admitted = { guarded: true, snapshot: false };
      const excluded = { guarded: false, snapshot: false };
      const expected = guardedFirst ? [admitted, excluded] : [excluded, admitted];
      expect(attributes.map(evaluate)).toEqual(expected);
      expect([...attributes].reverse().map(evaluate)).toEqual([...expected].reverse());
      expect(
        guardedFirst
          ? [
              hasSupportedCallbackMapProgram(scopes, permissions),
              hasSupportedCallbackMapProgram(scopes),
              hasSupportedCallbackMapProgram(scopes, permissions),
            ]
          : [
              hasSupportedCallbackMapProgram(scopes),
              hasSupportedCallbackMapProgram(scopes, permissions),
              hasSupportedCallbackMapProgram(scopes),
            ],
      ).toEqual(guardedFirst ? [true, false, true] : [false, true, false]);
      const result = runRule(noRefCallbackCleanupBeforeReact19, source, {
        filename: "/synthetic/guarded-map-proof/context.tsx",
        includeLocations: true,
        settings: {
          "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
        },
      });
      expect(result.parseErrors).toEqual([]);
      expect(
        result.diagnostics.map((diagnostic) => ({
          line: diagnostic.line,
          column: diagnostic.column,
        })),
      ).toEqual([{ line: guardedFirst ? 9 : 8, column: 4 }]);
    },
  );
});
