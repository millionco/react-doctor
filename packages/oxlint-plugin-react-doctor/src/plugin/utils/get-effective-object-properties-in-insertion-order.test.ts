import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "./get-effective-object-properties-in-insertion-order.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

const getObjectExpression = (source: string) => {
  const parsed = parseFixture(`const value = ${source};`);
  if (!isNodeOfType(parsed.program, "Program")) throw new Error("missing program");
  const declaration = parsed.program.body[0];
  if (!isNodeOfType(declaration, "VariableDeclaration")) throw new Error("missing declaration");
  const initializer = declaration.declarations[0]?.init;
  if (!isNodeOfType(initializer, "ObjectExpression")) throw new Error("missing object");
  return initializer;
};

const getEffectivePropertyNames = (source: string): string[] | null => {
  const objectExpression = getObjectExpression(source);
  const properties = getEffectiveObjectPropertiesInInsertionOrder(objectExpression.properties);
  return (
    properties?.flatMap((property) => {
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      return propertyName ? [propertyName] : [];
    }) ?? null
  );
};

describe("getEffectiveObjectPropertiesInInsertionOrder", () => {
  it("flattens static object spreads without changing key insertion order", () => {
    expect(
      getEffectivePropertyNames(
        `{ transition: "opacity 200ms", ...{ color: "red", transition: "all 200ms" }, opacity: 1 }`,
      ),
    ).toEqual(["transition", "color", "opacity"]);
    expect(getEffectivePropertyNames(`{ ...{ transition: "all 200ms" }, color: "red" }`)).toEqual([
      "transition",
      "color",
    ]);
  });

  it("flattens nested static spreads", () => {
    expect(
      getEffectivePropertyNames(`{ ...{ color: "red", ...{ transition: "all 200ms" } } }`),
    ).toEqual(["color", "transition"]);
  });

  it("returns unknown for dynamic spreads", () => {
    expect(getEffectivePropertyNames(`{ transition: "all 200ms", ...style }`)).toBeNull();
    expect(getEffectivePropertyNames(`{ ...{ transition: "all 200ms", ...style } }`)).toBeNull();
  });
});
