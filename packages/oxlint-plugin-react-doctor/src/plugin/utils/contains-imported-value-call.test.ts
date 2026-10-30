import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { containsImportedValueCall } from "./contains-imported-value-call.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

describe("imported alias origin cache declaration order", () => {
  for (const reverse of [false, true]) {
    it(`keeps per-use order after ${reverse ? "late" : "early"} use warms the origin`, () => {
      const parsed = parseFixture(`import readSnapshot from './reader';
        const early = {value: selectedReader()};
        const selectedReader = readSnapshot;
        const late = {value: selectedReader()};`);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const initializers: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "VariableDeclarator") &&
          isNodeOfType(node.id, "Identifier") &&
          (node.id.name === "early" || node.id.name === "late") &&
          node.init
        )
          initializers.push(node.init);
      });
      expect(parsed.errors).toEqual([]);
      expect(initializers).toHaveLength(2);
      const ordered = reverse ? [...initializers].reverse() : initializers;
      const expected = reverse ? [true, false] : [false, true];
      expect(ordered.map((expression) => containsImportedValueCall(expression, scopes))).toEqual(
        expected,
      );
      expect(
        [...ordered].reverse().map((expression) => containsImportedValueCall(expression, scopes)),
      ).toEqual([...expected].reverse());
      expect(ordered.map((expression) => containsImportedValueCall(expression, scopes))).toEqual(
        expected,
      );
    });
  }
});
