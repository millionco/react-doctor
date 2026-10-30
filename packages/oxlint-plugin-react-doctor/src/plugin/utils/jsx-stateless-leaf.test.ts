import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { containsStatefulDescendant } from "./jsx-stateless-leaf.js";
import { walkAst } from "./walk-ast.js";

const cases = [
  { name: "literal text", jsx: '<span><b>{"text"}</b></span>', expected: false },
  { name: "unknown identifier", jsx: "<span>{value}</span>", expected: true },
  { name: "unknown member", jsx: "<span>{value.text}</span>", expected: true },
  { name: "unknown call", jsx: "<span>{render()}</span>", expected: true },
  {
    name: "split index without exception",
    jsx: '<span><b>{token.split(":")[1]}</b></span>',
    expected: true,
  },
  {
    name: "conditional form control",
    jsx: '<span>{enabled ? <input/> : "text"}</span>',
    expected: true,
  },
  { name: "logical custom component", jsx: "<span>{enabled && <Child/>}</span>", expected: true },
  {
    name: "interactive attribute",
    jsx: "<span><b contentEditable>text</b></span>",
    expected: true,
  },
  { name: "display fragment", jsx: "<span><><b>first</b><i>second</i></></span>", expected: false },
  {
    name: "existing scan budget",
    jsx: `<span>${"<b>text</b>".repeat(201)}</span>`,
    expected: true,
  },
];

describe("stateless leaf default scanner", () => {
  it.each(cases)("$name", ({ jsx, expected }) => {
    const parsed = parseFixture(`const value = ${jsx};`);
    expect(parsed.errors).toEqual([]);
    let row: EsTreeNode | undefined;
    walkAst(parsed.program, (node) => {
      if (!row && isNodeOfType(node, "JSXElement")) row = node;
    });
    if (!row) throw new Error("Missing JSX row");
    expect(containsStatefulDescendant(row)).toBe(expected);
    expect(containsStatefulDescendant(row, { primitiveChild: () => false })).toBe(expected);
  });
});
