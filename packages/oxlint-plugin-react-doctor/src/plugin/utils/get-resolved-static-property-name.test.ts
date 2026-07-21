import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

describe("getResolvedStaticPropertyName", () => {
  it("resolves direct keys and stable const string aliases", () => {
    const parsed = parseFixture(`
      const propertyName = "aliased";
      const aliasedPropertyName = propertyName;
      object.direct;
      object["literal"];
      object[\`templated\`];
      object[aliasedPropertyName];
    `);
    expect(parsed.errors).toEqual([]);
    const scopes = analyzeScopes(parsed.program);
    const members: EsTreeNode[] = [];
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "MemberExpression")) members.push(node);
    });
    expect(members.map((member) => getResolvedStaticPropertyName(member, scopes))).toEqual([
      "direct",
      "literal",
      "templated",
      "aliased",
    ]);
  });

  it("keeps template and numeric const aliases opt-in", () => {
    const parsed = parseFixture(`
      const templatePropertyName = \`templated\`;
      const numericPropertyName = 1;
      object[templatePropertyName];
      object[numericPropertyName];
    `);
    expect(parsed.errors).toEqual([]);
    const scopes = analyzeScopes(parsed.program);
    const members: EsTreeNode[] = [];
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "MemberExpression")) members.push(node);
    });
    expect(members.map((member) => getResolvedStaticPropertyName(member, scopes))).toEqual([
      null,
      null,
    ]);
    expect(
      members.map((member) =>
        getResolvedStaticPropertyName(member, scopes, {
          allowConstNumericLiteral: true,
          allowConstTemplateLiteral: true,
        }),
      ),
    ).toEqual(["templated", "1"]);
  });

  it("rejects mutable and dynamic computed keys", () => {
    const parsed = parseFixture(`
      let mutablePropertyName = "mutable";
      const dynamicPropertyName = \`dynamic-\${suffix}\`;
      object[mutablePropertyName];
      object[dynamicPropertyName];
    `);
    expect(parsed.errors).toEqual([]);
    const scopes = analyzeScopes(parsed.program);
    const members: EsTreeNode[] = [];
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "MemberExpression")) members.push(node);
    });
    expect(
      members.map((member) =>
        getResolvedStaticPropertyName(member, scopes, { allowConstTemplateLiteral: true }),
      ),
    ).toEqual([null, null]);
  });
});
