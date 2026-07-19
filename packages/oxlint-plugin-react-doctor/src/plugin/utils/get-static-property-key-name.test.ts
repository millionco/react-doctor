import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import {
  getStaticPropertyKeyName,
  type StaticPropertyKeyOptions,
} from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

interface StaticPropertyKeyTestCase {
  expectedComputedString: string | null;
  expectedNumericLiteral: string | null;
  name: string;
  options?: StaticPropertyKeyOptions;
}

const readFixtureProperties = (): Map<number, EsTreeNode> => {
  const parsed = parseFixture(`
    const options = {
      plain: "plain",
      "quoted": "quoted",
      ["computed"]: "computed",
      42: "numeric",
      [43]: "computed-numeric",
    };
  `);
  expect(parsed.errors).toEqual([]);
  const propertiesByValue = new Map<number, EsTreeNode>();
  let propertyIndex = 0;
  walkAst(parsed.program, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "Property")) return;
    propertiesByValue.set(propertyIndex, node);
    propertyIndex += 1;
  });
  return propertiesByValue;
};

const requireProperty = (
  properties: Map<number, EsTreeNode>,
  propertyIndex: number,
): EsTreeNode => {
  const property = properties.get(propertyIndex);
  if (!property) throw new Error(`fixture has no property at index ${String(propertyIndex)}`);
  return property;
};

describe("getStaticPropertyKeyName", () => {
  const testCases: StaticPropertyKeyTestCase[] = [
    {
      name: "default options",
      expectedComputedString: null,
      expectedNumericLiteral: null,
    },
    {
      name: "computed strings enabled",
      options: { allowComputedString: true },
      expectedComputedString: "computed",
      expectedNumericLiteral: null,
    },
    {
      name: "non-string stringification enabled",
      options: { stringifyNonStringLiterals: true },
      expectedComputedString: null,
      expectedNumericLiteral: "42",
    },
    {
      name: "all options enabled",
      options: {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      },
      expectedComputedString: "computed",
      expectedNumericLiteral: "42",
    },
  ];

  for (const testCase of testCases) {
    it(`handles ${testCase.name}`, () => {
      const properties = readFixtureProperties();
      expect(getStaticPropertyKeyName(requireProperty(properties, 0), testCase.options)).toBe(
        "plain",
      );
      expect(getStaticPropertyKeyName(requireProperty(properties, 1), testCase.options)).toBe(
        "quoted",
      );
      expect(getStaticPropertyKeyName(requireProperty(properties, 2), testCase.options)).toBe(
        testCase.expectedComputedString,
      );
      expect(getStaticPropertyKeyName(requireProperty(properties, 3), testCase.options)).toBe(
        testCase.expectedNumericLiteral,
      );
      expect(getStaticPropertyKeyName(requireProperty(properties, 4), testCase.options)).toBe(null);
    });
  }

  it("reads class method keys", () => {
    const parsed = parseFixture(`
      class Helper {
        clear() {}
        ["computed"]() {}
      }
    `);
    expect(parsed.errors).toEqual([]);
    const methods: EsTreeNode[] = [];
    walkAst(parsed.program, (node: EsTreeNode) => {
      if (isNodeOfType(node, "MethodDefinition")) methods.push(node);
    });
    const clearMethod = methods[0];
    const computedMethod = methods[1];
    if (!clearMethod || !computedMethod) throw new Error("fixture class methods were not parsed");
    expect(getStaticPropertyKeyName(clearMethod)).toBe("clear");
    expect(getStaticPropertyKeyName(computedMethod)).toBe(null);
    expect(getStaticPropertyKeyName(computedMethod, { allowComputedString: true })).toBe(
      "computed",
    );
  });

  it("reads static member keys including no-substitution templates", () => {
    const parsed = parseFixture(`
      object.plain;
      object["computed"];
      object[\`templated\`];
      object[\`dynamic-\${suffix}\`];
    `);
    expect(parsed.errors).toEqual([]);
    const members: EsTreeNode[] = [];
    walkAst(parsed.program, (node: EsTreeNode) => {
      if (isNodeOfType(node, "MemberExpression")) members.push(node);
    });
    expect(getStaticPropertyKeyName(members[0]!)).toBe("plain");
    expect(getStaticPropertyKeyName(members[1]!)).toBe(null);
    expect(getStaticPropertyKeyName(members[1]!, { allowComputedString: true })).toBe("computed");
    expect(getStaticPropertyKeyName(members[2]!, { allowComputedString: true })).toBe("templated");
    expect(getStaticPropertyKeyName(members[3]!, { allowComputedString: true })).toBe(null);
  });
});
