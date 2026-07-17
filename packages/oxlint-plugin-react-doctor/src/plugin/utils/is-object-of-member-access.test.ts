import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isObjectOfMemberAccess } from "./is-object-of-member-access.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const findNonNullExpression = (sourceText: string): EsTreeNode => {
  const program = parseSourceText({ filename: "/tmp/member-access.ts", sourceText });
  if (!program) throw new Error("Expected test source to parse");
  let result: EsTreeNode | null = null;
  walkAst(program, (node) => {
    if (!result && isNodeOfType(node, "TSNonNullExpression")) result = node;
  });
  if (!result) throw new Error("Expected a non-null expression");
  return result;
};

describe("isObjectOfMemberAccess", () => {
  it("recognizes a direct member read", () => {
    expect(isObjectOfMemberAccess(findNonNullExpression("items.find(check)!.name;"))).toBe(true);
  });

  it("looks through grouping parentheses", () => {
    expect(isObjectOfMemberAccess(findNonNullExpression("(items.find(check)!).name;"))).toBe(true);
  });

  it("does not treat a member argument as the member receiver", () => {
    expect(isObjectOfMemberAccess(findNonNullExpression("consume(items.find(check)!);"))).toBe(
      false,
    );
  });
});
