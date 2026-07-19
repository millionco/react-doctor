import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { attachSourceLocations } from "../../test-utils/attach-source-locations.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import {
  functionReturnsMatchingExpression,
  functionReturnsMatchingExpressionOnEveryPathAfterNode,
} from "./function-returns-matching-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const mainFunctionReturnsJsx = (code: string, matchMode: "some" | "every" = "some"): boolean => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  attachSourceLocations(parsed.program, code);
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
    analyzeControlFlow(parsed.program),
    matchMode,
  );
};

const mainFunctionReturnsJsxAfterMarker = (code: string): boolean => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  attachSourceLocations(parsed.program, code);
  let mainFunction: EsTreeNode | null = null;
  let markerCall: EsTreeNode | null = null;
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "FunctionDeclaration") && node.id?.name === "Main" && !mainFunction) {
      mainFunction = node;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "mark" &&
      !markerCall
    ) {
      markerCall = node;
    }
  });
  if (!mainFunction || !markerCall) throw new Error("Expected a Main function and mark call");
  return functionReturnsMatchingExpressionOnEveryPathAfterNode(
    mainFunction,
    markerCall,
    analyzeScopes(parsed.program),
    (expression) =>
      isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment"),
    analyzeControlFlow(parsed.program),
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

  it("follows let and var bindings through initializer and assignment values", () => {
    expect(
      mainFunctionReturnsJsx(`function Main() { let output = <main />; return output; }`),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { let output = null; if (condition) output = <main />; return output; }`,
      ),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { var output; if (condition) { output = <main />; } else { output = null; } return output; }`,
      ),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { let output = null; if (condition) output = "text"; return output; }`,
      ),
    ).toBe(false);
  });

  it("ignores unreachable and overwritten JSX writes to returned bindings", () => {
    expect(
      mainFunctionReturnsJsx(
        `function Main() { let output = "label"; function unused() { output = <main />; } return output; }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { let output = "label"; return output; output = <main />; }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { let output = <main />; output = "label"; return output; }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main(condition) { let output; if (condition) { output = <main />; return "label"; } return output; }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { let output = <main />; for (output = "label"; false; ) {} return output; }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsx(
        `function Main() { return "label"; let output = <main />; return output; }`,
      ),
    ).toBe(false);
  });

  it("keeps deferred, mutable, parameterized, imported, and recursive values opaque", () => {
    expect(
      mainFunctionReturnsJsx(`function Main() { const render = () => <main />; return render; }`),
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

  it("requires matching returns only on paths reachable after a marker", () => {
    expect(
      mainFunctionReturnsJsxAfterMarker(
        `function Main(ready) { if (!ready) return null; mark(); return <main />; }`,
      ),
    ).toBe(true);
    expect(
      mainFunctionReturnsJsxAfterMarker(
        `function Main(ready, skip) { if (!ready) return null; mark(); if (skip) return null; return <main />; }`,
      ),
    ).toBe(false);
    expect(
      mainFunctionReturnsJsxAfterMarker(
        `function Main(ready, alternate) { if (!ready) return null; mark(); return alternate ? <main /> : <aside />; }`,
      ),
    ).toBe(true);
  });
});
