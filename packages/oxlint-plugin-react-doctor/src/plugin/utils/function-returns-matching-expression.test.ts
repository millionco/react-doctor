import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const mainFunctionReturnsJsx = (code: string, matchMode: "some" | "every" = "some"): boolean => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  let mainFunction: EsTreeNode | null = null;
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "FunctionDeclaration") && node.id?.name === "Main" && !mainFunction) {
      mainFunction = node;
    }
  });
  if (!mainFunction) throw new Error("Expected a Main function");
  return functionReturnsMatchingExpression(
    mainFunction,
    analyzeScopes(parsed.program),
    (expression) =>
      isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment"),
    matchMode,
  );
};

describe("functionReturnsMatchingExpression", () => {
  it("follows returned const values and zero-argument helpers", () => {
    expect(
      mainFunctionReturnsJsx(`function Main() { const output = <main />; return output; }`),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(`function Main() { const render = () => <main />; return render(); }`),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { const render = (() => <main />) as () => JSX.Element; return render(); }`,
      ),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { const output = <main />; return condition ? output : null; }`,
      ),
    ).toBe(true);
  });

  it("keeps deferred, mutable, parameterized, imported, and recursive values opaque", () => {
    expect(
      mainFunctionReturnsJsx(`function Main() { const render = () => <main />; return render; }`),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(`function Main() { let output = <main />; return output; }`),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(`function Main() { let render = () => <main />; return render(); }`),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { const render = (value) => <main>{value}</main>; return render("x"); }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `import { render } from "./render"; function Main() { return render(); }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(`function Main() { const render = () => render(); return render(); }`),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { const render = async () => <main />; return render(); }`,
      ),
    ).toBe(false);
  });

  it("requires every reachable return in every mode", () => {
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { return condition ? <main /> : null; }`,
        "every",
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { if (condition) return <main />; return <aside />; }`,
        "every",
      ),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { if (condition) return <main />; }`,
        "every",
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { if (condition) return <main />; return; }`,
        "every",
      ),
    ).toBe(false);
  });
});
