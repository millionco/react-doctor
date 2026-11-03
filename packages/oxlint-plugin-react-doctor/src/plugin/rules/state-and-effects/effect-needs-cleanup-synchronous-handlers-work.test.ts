import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleResult } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface NativeCleanupWorkCounts {
  scopeCount: number;
  referenceCalls: number;
  referenceVisits: number;
  symbolCalls: number;
  symbolVisits: number;
}

interface NativeCleanupWorkObservation {
  result: RunRuleResult;
  counts: NativeCleanupWorkCounts;
}

const observeNativeCleanupWork = (sourceText: string): NativeCleanupWorkObservation => {
  const counts: NativeCleanupWorkCounts = {
    scopeCount: 0,
    referenceCalls: 0,
    referenceVisits: 0,
    symbolCalls: 0,
    symbolVisits: 0,
  };
  const observedRule: Rule = {
    ...effectNeedsCleanup,
    create: (context) => {
      const pendingScopes = [context.scopes.rootScope];
      while (pendingScopes.length > 0) {
        const scope = pendingScopes.pop();
        if (!scope) break;
        counts.scopeCount += 1;
        // HACK: Delegate scope-array predicates while counting only the native cleanup proof.
        const referenceSome = scope.references.some;
        scope.references.some = (predicate, receiver) => {
          const stack = new Error().stack ?? "";
          const isCleanupProof =
            stack.includes("isNativeTimerCleanupUnmodified") || stack.includes("isRelease");
          if (isCleanupProof) counts.referenceCalls += 1;
          return referenceSome.call(scope.references, (reference, index, references) => {
            if (isCleanupProof) counts.referenceVisits += 1;
            return predicate.call(receiver, reference, index, references);
          });
        };
        const symbolSome = scope.symbols.some;
        scope.symbols.some = (predicate, receiver) => {
          const stack = new Error().stack ?? "";
          const isCleanupProof =
            stack.includes("isNativeTimerCleanupUnmodified") || stack.includes("isRelease");
          if (isCleanupProof) counts.symbolCalls += 1;
          return symbolSome.call(scope.symbols, (symbol, index, symbols) => {
            if (isCleanupProof) counts.symbolVisits += 1;
            return predicate.call(receiver, symbol, index, symbols);
          });
        };
        pendingScopes.push(...scope.children);
      }
      return effectNeedsCleanup.create(context);
    },
  };
  return { result: runRule(observedRule, sourceText, { includeLocations: true }), counts };
};

describe("synchronous handler native cleanup proof work", () => {
  it.each([10, 40])("scans the scope tree once for %i handlers", (handlerCount) => {
    const sourceText = `declare const task: () => void;
      ${Array.from(
        { length: handlerCount },
        (_, handlerIndex) => `
        const Component${handlerIndex} = () => {
          const handleClick = () => {
            const timer = setInterval(task, 1000);
            clearInterval(timer);
          };
          return <button onClick={handleClick} />;
        };
      `,
      ).join("\n")}`;
    const observed = observeNativeCleanupWork(sourceText);
    expect(observed.result.parseErrors).toEqual([]);
    expect(observed.result.diagnostics).toEqual([]);
    expect(observed.result).toEqual(
      runRule(effectNeedsCleanup, sourceText, { includeLocations: true }),
    );
    expect(observed.counts.scopeCount).toBe(handlerCount * 2 + 1);
    expect(observed.counts.referenceCalls).toBe(observed.counts.scopeCount);
    expect(observed.counts.symbolCalls).toBe(observed.counts.scopeCount);
    expect(observed.counts.referenceVisits).toBe(handlerCount * 5);
    expect(observed.counts.symbolVisits).toBe(handlerCount * 3 + 1);
    const leaking = runRule(effectNeedsCleanup, sourceText.replaceAll("clearInterval(timer);", ""));
    expect(leaking.parseErrors).toEqual([]);
    expect(leaking.diagnostics).toHaveLength(handlerCount);
  });

  it.each([false, true])("keeps independent proofs per cleanup name, reversed=%s", (reversed) => {
    const handlers = [
      "const Leaking = () => { const click = () => { const timer = setInterval(task, 1000); clearInterval(timer); }; return <button onClick={click} />; };",
      "const Released = () => { const click = () => { const timer = setInterval(task, 1000); clearTimeout(timer); }; return <button onClick={click} />; };",
    ];
    const sourceText = `declare const task: () => void;
      globalThis.clearInterval = () => {};
      ${(reversed ? handlers.toReversed() : handlers).join("\n")}`;
    const observed = observeNativeCleanupWork(sourceText);
    expect(observed.result.parseErrors).toEqual([]);
    expect(observed.result.diagnostics).toHaveLength(1);
    expect(observed.result).toEqual(
      runRule(effectNeedsCleanup, sourceText, { includeLocations: true }),
    );
  });
});
