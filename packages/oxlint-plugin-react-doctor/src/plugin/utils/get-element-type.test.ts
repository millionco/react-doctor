import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getElementType } from "./get-element-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const parseOpeningElement = (jsx: string): EsTreeNodeOfType<"JSXOpeningElement"> => {
  const { program, errors } = parseFixture(`const rendered = ${jsx};`);
  expect(errors).toEqual([]);
  let openingElement: EsTreeNodeOfType<"JSXOpeningElement"> | null = null;
  walkAst(program, (child: EsTreeNode) => {
    if (openingElement) return false;
    if (isNodeOfType(child, "JSXOpeningElement")) openingElement = child;
  });
  if (!openingElement) throw new Error("fixture has no JSX opening element");
  return openingElement;
};

describe("getElementType", () => {
  it("resolves intrinsic elements to their tag name", () => {
    expect(getElementType(parseOpeningElement("<div />"), undefined)).toBe("div");
    expect(getElementType(parseOpeningElement("<img src='x.png' />"), undefined)).toBe("img");
  });

  it("resolves custom components to their identifier name", () => {
    expect(getElementType(parseOpeningElement("<Button />"), undefined)).toBe("Button");
  });

  it("flattens member-expression and namespaced names", () => {
    expect(getElementType(parseOpeningElement("<Menu.Item />"), undefined)).toBe("Menu.Item");
    expect(getElementType(parseOpeningElement("<svg:rect />"), undefined)).toBe("svg:rect");
  });

  it("returns the base name when settings carry no jsx-a11y block", () => {
    expect(getElementType(parseOpeningElement("<Button />"), {})).toBe("Button");
    expect(getElementType(parseOpeningElement("<Button />"), { "jsx-a11y": "bogus" })).toBe(
      "Button",
    );
  });

  it("maps components through settings['jsx-a11y'].components", () => {
    const settings = { "jsx-a11y": { components: { Button: "button" } } };
    expect(getElementType(parseOpeningElement("<Button />"), settings)).toBe("button");
    expect(getElementType(parseOpeningElement("<Anchor />"), settings)).toBe("Anchor");
  });

  it("prefers the polymorphic prop's string value over the tag", () => {
    const settings = { "jsx-a11y": { polymorphicPropName: "as" } };
    expect(getElementType(parseOpeningElement("<Box as='span' />"), settings)).toBe("span");
    expect(getElementType(parseOpeningElement("<Box AS='span' />"), settings)).toBe("span");
  });

  it("falls back past a non-string polymorphic prop value", () => {
    const settings = {
      "jsx-a11y": { polymorphicPropName: "as", components: { Box: "div" } },
    };
    expect(getElementType(parseOpeningElement("<Box as={tag} />"), settings)).toBe("div");
    expect(getElementType(parseOpeningElement("<Box as />"), settings)).toBe("div");
  });

  it("prefers the polymorphic prop over a components mapping", () => {
    const settings = {
      "jsx-a11y": { polymorphicPropName: "as", components: { Box: "div" } },
    };
    expect(getElementType(parseOpeningElement("<Box as='nav' />"), settings)).toBe("nav");
  });

  it("returns a stable result on repeated calls with the same settings object", () => {
    const settings = { "jsx-a11y": { components: { Button: "button" } } };
    const openingElement = parseOpeningElement("<Button />");
    expect(getElementType(openingElement, settings)).toBe("button");
    expect(getElementType(openingElement, settings)).toBe("button");
  });

  it("does not leak a cached result across different settings objects for the same node", () => {
    const openingElement = parseOpeningElement("<Button />");
    const buttonSettings = { "jsx-a11y": { components: { Button: "button" } } };
    const anchorSettings = { "jsx-a11y": { components: { Button: "a" } } };
    expect(getElementType(openingElement, buttonSettings)).toBe("button");
    expect(getElementType(openingElement, anchorSettings)).toBe("a");
    expect(getElementType(openingElement, undefined)).toBe("Button");
    expect(getElementType(openingElement, buttonSettings)).toBe("button");
  });

  it("does not leak a cached undefined-settings result into a mapped lookup", () => {
    const openingElement = parseOpeningElement("<Button />");
    expect(getElementType(openingElement, undefined)).toBe("Button");
    expect(
      getElementType(openingElement, { "jsx-a11y": { components: { Button: "button" } } }),
    ).toBe("button");
  });
});
