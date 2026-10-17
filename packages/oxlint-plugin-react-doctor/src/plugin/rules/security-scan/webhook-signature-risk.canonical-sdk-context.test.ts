import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isShopifyDataValue } from "./utils/is-shopify-data-value.js";
import { SHOPIFY_MAX_DATA_DEPTH } from "./utils/shopify-webhook-constants.js";

describe("Shopify readonly proof cache contexts", () => {
  for (const direction of ["forward", "reverse"]) {
    it(`keeps traversal permissions fresh in ${direction} order across analyses`, () => {
      const code =
        'import importedData from "./readonly-data.js";const selectedScope="read_products";const config={scopes:[selectedScope],user:importedData};';
      const parsed = parseFixture(code, { filename: "provider.js" });
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const nodes: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        nodes.push(node);
      });
      const scopesProperty = nodes.find(
        (node) =>
          isNodeOfType(node, "Property") &&
          isNodeOfType(node.key, "Identifier") &&
          node.key.name === "scopes",
      );
      const userProperty = nodes.find(
        (node) =>
          isNodeOfType(node, "Property") &&
          isNodeOfType(node.key, "Identifier") &&
          node.key.name === "user",
      );
      if (
        !isNodeOfType(scopesProperty, "Property") ||
        !isNodeOfType(scopesProperty.value, "ArrayExpression") ||
        !isNodeOfType(userProperty, "Property")
      )
        throw new Error("Missing synthetic data properties");
      const selectedRead = scopesProperty.value.elements[0];
      if (!isNodeOfType(selectedRead, "Identifier"))
        throw new Error("Missing synthetic scope read");
      const importedRead = userProperty.value;
      for (const scopes of [analyzeScopes(parsed.program), analyzeScopes(parsed.program)]) {
        const symbol = scopes.symbolFor(selectedRead);
        if (!symbol?.initializer) throw new Error("Missing synthetic readonly initializer");
        const initializer = symbol.initializer;
        const probes = [
          {
            name: "ordinary readonly",
            expected: true,
            inspect: () => isShopifyDataValue(selectedRead, scopes),
          },
          {
            name: "depth frontier",
            expected: false,
            inspect: () =>
              isShopifyDataValue(selectedRead, scopes, false, new Set(), SHOPIFY_MAX_DATA_DEPTH),
          },
          {
            name: "active traversal",
            expected: false,
            inspect: () => isShopifyDataValue(selectedRead, scopes, false, new Set([initializer])),
          },
          {
            name: "allowed imported data",
            expected: true,
            inspect: () => isShopifyDataValue(importedRead, scopes, true),
          },
          {
            name: "disallowed imported data",
            expected: false,
            inspect: () => isShopifyDataValue(importedRead, scopes, false),
          },
        ];
        if (direction === "reverse") probes.reverse();
        for (const sequence of [probes, [...probes].reverse(), probes]) {
          for (const probe of sequence) expect(probe.inspect(), probe.name).toBe(probe.expected);
        }
      }
    });
  }
});
