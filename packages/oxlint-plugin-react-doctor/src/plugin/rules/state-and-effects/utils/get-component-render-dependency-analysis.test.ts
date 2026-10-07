import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { getComponentRenderDependencyAnalysis } from "./get-component-render-dependency-analysis.js";

const parseComponent = (): {
  componentBody: EsTreeNode;
  program: EsTreeNode;
} => {
  const parsed = parseFixture(`
    function Widget({ items }) {
      const visibleItems = items.filter(Boolean);
      const handleClick = () => console.log(items.length);
      return <button onClick={handleClick}>{visibleItems.length}</button>;
    }
  `);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  let componentBody: EsTreeNode | null = null;
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "FunctionDeclaration") && node.id?.name === "Widget") {
      componentBody = node.body;
      return false;
    }
  });
  if (!componentBody) throw new Error("Expected a component body");
  return { componentBody, program: parsed.program };
};

describe("getComponentRenderDependencyAnalysis", () => {
  it("reuses analysis for the same component and scopes", () => {
    const { componentBody, program } = parseComponent();
    const scopes = analyzeScopes(program);
    const firstAnalysis = getComponentRenderDependencyAnalysis(componentBody, scopes);
    const secondAnalysis = getComponentRenderDependencyAnalysis(componentBody, scopes);

    expect(secondAnalysis).toBe(firstAnalysis);
    expect(firstAnalysis.renderReachableNames).toContain("items");
    expect(firstAnalysis.renderReachableNames).toContain("visibleItems");
  });

  it("keeps analyses separate across scope instances", () => {
    const { componentBody, program } = parseComponent();
    const firstAnalysis = getComponentRenderDependencyAnalysis(
      componentBody,
      analyzeScopes(program),
    );
    const secondAnalysis = getComponentRenderDependencyAnalysis(
      componentBody,
      analyzeScopes(program),
    );

    expect(secondAnalysis).not.toBe(firstAnalysis);
    expect(secondAnalysis.renderReachableNames).toEqual(firstAnalysis.renderReachableNames);
  });
});
