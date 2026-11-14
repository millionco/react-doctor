import { describe, expect, it, vi } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import * as astWalker from "../../utils/walk-ast.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";
import { isPrimitiveStringTokenSplitChild } from "./utils/is-primitive-string-token-split-child.js";

const measureWork = (code: string) => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const children: EsTreeNode[] = [];
  let typeReads = 0;
  astWalker.walkAst(parsed.program, (node) => {
    if (
      isNodeOfType(node, "JSXExpressionContainer") &&
      isNodeOfType(node.expression, "MemberExpression")
    )
      children.push(node.expression);
  });
  astWalker.walkAst(parsed.program, (node) => {
    const originalType = node.type;
    Object.defineProperty(node, "type", {
      configurable: true,
      enumerable: true,
      get: () => {
        typeReads += 1;
        return originalType;
      },
    });
  });
  const originalWalk = astWalker.walkAst;
  let programWalks = 0;
  let rowWalks = 0;
  const walkSpy = vi.spyOn(astWalker, "walkAst").mockImplementation((node, visitor) => {
    if (node === parsed.program) programWalks += 1;
    else if (isNodeOfType(node, "JSXElement")) rowWalks += 1;
    originalWalk(node, visitor);
  });
  const admitted = children.map((child) => {
    let current: EsTreeNode | undefined = child;
    let row: EsTreeNode | undefined;
    while (current) {
      if (
        isNodeOfType(current, "JSXElement") &&
        current.openingElement.attributes.some(
          (attribute) =>
            isNodeOfType(attribute, "JSXAttribute") &&
            isNodeOfType(attribute.name, "JSXIdentifier") &&
            attribute.name.name === "key",
        )
      )
        row = current;
      if (isNodeOfType(current, "ArrowFunctionExpression") && current.params.length === 2) {
        if (!row || !current.parent) throw new Error("Missing selected iterator row");
        return isPrimitiveStringTokenSplitChild(child, current.parent, row, scopes);
      }
      current = current.parent ?? undefined;
    }
    throw new Error("Missing selected iterator callback");
  });
  walkSpy.mockRestore();
  return { typeReads, programWalks, rowWalks, admitted };
};

const createRow = (childCount: number) =>
  `export const Example=({text}:{text:string})=><div>{text.split(' ').map((token,index)=><span key={index}><b>${'{token.split(":")[1]}'.repeat(childCount)}</b></span>)}</div>;`;

interface WorkShape {
  name: string;
  createCode: (count: number) => string;
  expectedRows: (count: number) => number;
}

const workShapes: WorkShape[] = [
  {
    name: "one row with repeated primitive children",
    createCode: createRow,
    expectedRows: () => 1,
  },
  {
    name: "independent rows",
    createCode: (count) =>
      Array.from({ length: count }, (_, index) =>
        createRow(1).replace("Example", `Example${index}`),
      ).join(""),
    expectedRows: (count) => count,
  },
  {
    name: "closed primitive dictionary reads",
    createCode: (count) =>
      `const styles={small:"compact",large:"roomy"};${"void styles[selection];".repeat(count)}${createRow(1)}`,
    expectedRows: () => 1,
  },
];

describe("primitive split child bounded proof work", () => {
  it.each(workShapes)("$name", ({ createCode, expectedRows }) => {
    const smallCode = createCode(20);
    const largeCode = createCode(100);
    const small = measureWork(smallCode);
    const large = measureWork(largeCode);
    expect(small.admitted.length).toBeGreaterThan(0);
    expect(small.admitted.every(Boolean)).toBe(true);
    expect(large.admitted.every(Boolean)).toBe(true);
    expect(small.programWalks).toBe(1);
    expect(large.programWalks).toBe(1);
    expect(small.rowWalks).toBe(expectedRows(20));
    expect(large.rowWalks).toBe(expectedRows(100));
    expect(large.typeReads).toBeLessThan(small.typeReads * 6);
    for (const code of [smallCode, largeCode]) {
      expect(runRule(noArrayIndexAsKey, code).diagnostics).toHaveLength(0);
      expect(
        runRule(noArrayIndexAsKey, code.replace("text:string", "text:any")).diagnostics.length,
      ).toBeGreaterThan(0);
    }
  });
  it("reuses rejected provider and row proofs without admitting either", () => {
    const provider = measureWork(`void String;${createRow(20)}`);
    expect(provider.admitted).toEqual(Array(20).fill(false));
    expect(provider.programWalks).toBe(1);
    expect(provider.rowWalks).toBe(1);
    const row = measureWork(
      createRow(20).replace("<span key={index}>", "<span key={index} onClick={()=>{}}>"),
    );
    expect(row.admitted).toEqual(Array(20).fill(false));
    expect(row.rowWalks).toBe(1);
    expect(row.programWalks).toBe(0);
  });
});
