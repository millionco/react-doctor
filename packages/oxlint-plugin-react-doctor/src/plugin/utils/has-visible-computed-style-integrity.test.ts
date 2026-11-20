import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { readsPostMountValueThroughLocals } from "../rules/state-and-effects/utils/reads-post-mount-through-locals.js";
import { hasVisibleComputedStyleIntegrity } from "./has-visible-computed-style-integrity.js";
import { isBareComputedStyleRead } from "./is-bare-computed-style-read.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const prepareCountedAnalysis = (code: string) => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const readProgram = vi.fn(() => parsed.program);
  Object.defineProperty(scopes.rootScope, "node", { get: readProgram });
  return { program: parsed.program, scopes, readProgram };
};

describe("visible computed-style integrity cache", () => {
  it("scans once for multiple eligible reads in one immutable analysis", () => {
    const { program, scopes, readProgram } = prepareCountedAnalysis(`
      const first = getComputedStyle(firstElement).opacity;
      const second = getComputedStyle(secondElement).width;
      const third = getComputedStyle(thirdElement).height;
    `);
    let eligibleCallCount = 0;
    walkAst(program, (node) => {
      if (isNodeOfType(node, "CallExpression") && isBareComputedStyleRead(node, node, scopes))
        eligibleCallCount += 1;
      if (isNodeOfType(node, "CallExpression"))
        expect(readsPostMountValueThroughLocals(node, program, { scopes })).toBe(false);
    });
    expect(eligibleCallCount).toBe(3);
    expect(readProgram).toHaveBeenCalledTimes(1);
    expect(hasVisibleComputedStyleIntegrity(scopes)).toBe(true);
    expect(readProgram).toHaveBeenCalledTimes(1);
  });

  it("caches refusal without bleeding into a fresh safe analysis", () => {
    const unsafe = prepareCountedAnalysis(`
      globalThis.getComputedStyle = customReader;
      getComputedStyle(element);
    `);
    expect(hasVisibleComputedStyleIntegrity(unsafe.scopes)).toBe(false);
    expect(hasVisibleComputedStyleIntegrity(unsafe.scopes)).toBe(false);
    expect(unsafe.readProgram).toHaveBeenCalledTimes(1);
    const safe = prepareCountedAnalysis("getComputedStyle(element);");
    expect(hasVisibleComputedStyleIntegrity(safe.scopes)).toBe(true);
    expect(safe.readProgram).toHaveBeenCalledTimes(1);
    expect(hasVisibleComputedStyleIntegrity(unsafe.scopes)).toBe(false);
    expect(unsafe.readProgram).toHaveBeenCalledTimes(1);
  });
});
