import { describe, expect, it, vi } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import * as astWalker from "../../utils/walk-ast.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const SMALL_HANDLER_COUNT = 8;
const LARGE_HANDLER_COUNT = 40;

const buildRetainedHandlersSource = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
): string => {
  const handlers = Array.from(
    { length: handlerCount },
    (_, handlerIndex) =>
      `const handler${handlerIndex} = () => { ${buildRegistration(handlerIndex)} };`,
  ).join("\n");
  const buttons = Array.from(
    { length: handlerCount },
    (_, handlerIndex) => `<button onClick={handler${handlerIndex}} />`,
  ).join("\n");
  return `const Component = () => {\n${handlers}\nreturn <>${buttons}</>;\n};`;
};

const countWholeTreeWalks = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
) => {
  const source = buildRetainedHandlersSource(handlerCount, buildRegistration);
  const parsed = parseFixture(source);
  let componentBody: EsTreeNode | undefined;
  astWalker.walkAst(parsed.program, (node) => {
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === "Component" &&
      isNodeOfType(node.init, "ArrowFunctionExpression")
    ) {
      componentBody = node.init.body;
    }
  });
  expect(componentBody).toBeDefined();
  let programWalkCount = 0;
  let componentWalkCount = 0;
  const originalWalkAst = astWalker.walkAst;
  const walkSpy = vi.spyOn(astWalker, "walkAst").mockImplementation((node, visitor) => {
    if (node === parsed.program) programWalkCount += 1;
    if (node === componentBody) componentWalkCount += 1;
    return originalWalkAst(node, visitor);
  });
  try {
    const result = runRuleOnParsedFixture(effectNeedsCleanup, source, parsed);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(handlerCount);
    return { programWalkCount, componentWalkCount };
  } finally {
    walkSpy.mockRestore();
  }
};

describe("effect-needs-cleanup performance", () => {
  for (const performanceCase of [
    {
      name: "timers",
      buildRegistration: (handlerIndex: number) => `setInterval(task${handlerIndex}, 1000);`,
      releasedSource: `const Component = () => { useEffect(() => { const handle = setInterval(task, 1000); return () => clearInterval(handle); }, []); return null; };`,
      expectsProgramScan: false,
    },
    {
      name: "listeners",
      buildRegistration: (handlerIndex: number) =>
        `window.addEventListener("resize", listener${handlerIndex});`,
      releasedSource: buildRetainedHandlersSource(
        SMALL_HANDLER_COUNT,
        (handlerIndex) =>
          `window.addEventListener("resize", listener${handlerIndex}); window.removeEventListener("resize", listener${handlerIndex});`,
      ),
      expectsProgramScan: true,
    },
  ]) {
    it(`reuses whole-tree scans across retained ${performanceCase.name}`, () => {
      const smallCounts = countWholeTreeWalks(
        SMALL_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      const largeCounts = countWholeTreeWalks(
        LARGE_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      expect(smallCounts.componentWalkCount).toBeGreaterThan(0);
      if (performanceCase.expectsProgramScan) {
        expect(smallCounts.programWalkCount).toBeGreaterThan(0);
      }
      expect(largeCounts.componentWalkCount).toBe(smallCounts.componentWalkCount);
      expect(largeCounts.programWalkCount).toBe(smallCounts.programWalkCount);
    });

    it(`accepts matching cleanup for ${performanceCase.name}`, () => {
      const result = runRule(effectNeedsCleanup, performanceCase.releasedSource);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  }
});
