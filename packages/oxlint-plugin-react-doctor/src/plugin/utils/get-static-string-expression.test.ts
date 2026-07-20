import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const resolveInitializer = (source: string): string | null => {
  const { program, errors } = parseFixture(`const value = ${source};`);
  expect(errors).toEqual([]);
  let initializer: EsTreeNode | null = null;
  walkAst(program, (node) => {
    if (!isNodeOfType(node, "VariableDeclarator") || node.init === null) return;
    initializer = node.init;
    return false;
  });
  return getStaticStringExpression(initializer);
};

describe("getStaticStringExpression", () => {
  it("unwraps transparent TypeScript and parenthesis wrappers", () => {
    expect(resolveInitializer('("dashboard" as const)')).toBe("dashboard");
    expect(resolveInitializer('("dashboard" satisfies string)')).toBe("dashboard");
    expect(resolveInitializer('("dashboard")!')).toBe("dashboard");
    expect(resolveInitializer('(("dashboard"))')).toBe("dashboard");
    expect(resolveInitializer("(`dashboard` as const)")).toBe("dashboard");
  });

  it("does not resolve dynamic wrapped expressions", () => {
    expect(resolveInitializer("(routePath as string)")).toBeNull();
    expect(resolveInitializer("`${routePath}` satisfies string")).toBeNull();
  });
});
