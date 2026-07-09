import { describe, expect, it } from "@voidzero-dev/vite-plus-test";
import {
  calculateRawLinesChanged,
  calculateWeightedTreeEditDistance,
  collectChangeComplexityFunctionEntries,
} from "./change-complexity.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";

const parseAndCollect = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return collectChangeComplexityFunctionEntries(parsed.program, code, "src/example.ts");
};

const findFunction = (functions: ReturnType<typeof parseAndCollect>, name: string) =>
  functions.find((functionEntry) => functionEntry.name === name);

describe("change complexity", () => {
  it("keeps formatting-only changes near zero while counting raw churn", () => {
    const baseFunctions = parseAndCollect(`
export function formatOnly(value: number) { return value + 1; }
`);
    const headFunctions = parseAndCollect(`
export function formatOnly(value: number) {
  return value + 1;
}
`);

    const baseFunction = findFunction(baseFunctions, "formatOnly");
    const headFunction = findFunction(headFunctions, "formatOnly");
    expect(baseFunction).toBeDefined();
    expect(headFunction).toBeDefined();
    if (baseFunction === undefined || headFunction === undefined) return;

    const treeEdit = calculateWeightedTreeEditDistance(headFunction.node, baseFunction.node);
    expect(treeEdit.essentialChange).toBe(0);
    expect(calculateRawLinesChanged(headFunction, baseFunction)).toBeGreaterThan(0);
  });

  it("assigns a positive essential change to a real branch insertion", () => {
    const baseFunctions = parseAndCollect(`
export function branchy(value: number) {
  return value;
}
`);
    const headFunctions = parseAndCollect(`
export function branchy(value: number) {
  if (value > 0) {
    return 1;
  }
  return value;
}
`);

    const baseFunction = findFunction(baseFunctions, "branchy");
    const headFunction = findFunction(headFunctions, "branchy");
    expect(baseFunction).toBeDefined();
    expect(headFunction).toBeDefined();
    if (baseFunction === undefined || headFunction === undefined) return;

    const treeEdit = calculateWeightedTreeEditDistance(headFunction.node, baseFunction.node);
    expect(treeEdit.essentialChange).toBeGreaterThan(0);
  });
});
