import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

const SMALL_SETTER_COUNT = 2_000;
const LARGE_SETTER_COUNT = 10_000;
const INDEPENDENT_FUNCTION_COUNT = 2;
const asyncFunctionScanCounter = vi.hoisted(() => vi.fn());

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: ((node, visitor) => {
      if (node.type === "ArrowFunctionExpression" && "async" in node && node.async)
        asyncFunctionScanCounter();
      return originalModule.walkAst(node, visitor);
    }) satisfies typeof originalModule.walkAst,
  };
});

const buildAwaitedTogglesSource = (setterCount: number): string =>
  `const C=()=>{const[open,setOpen]=useState(false);const run=async()=>{await load();${"setOpen(!open);".repeat(setterCount)}}}`;

const measureFunctionScans = (source: string, setterCount: number): number => {
  asyncFunctionScanCounter.mockClear();
  const result = runRule(noBooleanToggleWithoutFunctionalUpdate, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(setterCount);
  return asyncFunctionScanCounter.mock.calls.length;
};

describe("no-boolean-toggle-without-functional-update performance", () => {
  it("caches await reachability across many setters", () => {
    const smallSource = buildAwaitedTogglesSource(SMALL_SETTER_COUNT);
    const largeSource = buildAwaitedTogglesSource(LARGE_SETTER_COUNT);
    const smallFunctionScans = measureFunctionScans(smallSource, SMALL_SETTER_COUNT);
    const largeFunctionScans = measureFunctionScans(largeSource, LARGE_SETTER_COUNT);
    expect(smallFunctionScans).toBeGreaterThan(0);
    expect(largeFunctionScans).toBe(smallFunctionScans);
    const independentSource = smallSource + ";" + smallSource.replace("const C=", "const Other=");
    const independentFunctionScans = measureFunctionScans(
      independentSource,
      SMALL_SETTER_COUNT * INDEPENDENT_FUNCTION_COUNT,
    );
    expect(independentFunctionScans).toBe(smallFunctionScans * INDEPENDENT_FUNCTION_COUNT);
  });
});
