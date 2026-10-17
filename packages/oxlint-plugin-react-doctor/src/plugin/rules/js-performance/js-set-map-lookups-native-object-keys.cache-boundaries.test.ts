import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNativeObjectKeysIterationReceiver } from "../../utils/is-native-object-keys-iteration-receiver.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

describe("native Object.keys iteration owner cache boundaries", () => {
  for (const directFirst of [true, false]) {
    it(`keeps the deferred use declined when ${directFirst ? "immediate" : "deferred"} use is visited first`, () => {
      const direct = 'const immediate=Object.keys(row).includes("selected");';
      const deferred = 'reads.push(()=>Object.keys(row).includes("selected"));';
      const code = `export const select=rows=>{\nconst reads=[];\nfor(const row of rows){\n${directFirst ? direct : deferred}\n${directFirst ? deferred : direct}\n}\nreturn reads;\n};`;
      const parsed = parseFixture(code);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const receivers: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "MemberExpression") &&
          isNodeOfType(node.callee.object, "Identifier") &&
          node.callee.object.name === "Object" &&
          isNodeOfType(node.callee.property, "Identifier") &&
          node.callee.property.name === "keys"
        )
          receivers.push(node);
      });
      const expected = directFirst ? [true, false] : [false, true];
      expect(parsed.errors).toEqual([]);
      expect(receivers).toHaveLength(expected.length);
      expect(
        receivers.map((receiver) => isNativeObjectKeysIterationReceiver(receiver, scopes)),
      ).toEqual(expected);
      expect(
        [...receivers]
          .reverse()
          .map((receiver) => isNativeObjectKeysIterationReceiver(receiver, scopes)),
      ).toEqual([...expected].reverse());
      expect(
        receivers.map((receiver) => isNativeObjectKeysIterationReceiver(receiver, scopes)),
      ).toEqual(expected);
      const result = runRule(jsSetMapLookups, code, {
        filename: "/synthetic/native-keys-work/context.ts",
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map(({ line, column }) => ({ line, column }))).toEqual([
        { line: directFirst ? 5 : 4, column: 15 },
      ]);
    });
  }
});
