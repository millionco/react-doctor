import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

interface StoredDisposerCleanupCase {
  name: string;
  cleanup: string;
}

interface StoredDisposerRuleCase {
  name: string;
  rule: Rule;
}

const makeStoredObserverDisposerEffect = (
  cleanup: string,
  factoryExpression = "() =>",
  doesConsumeFactory = false,
): string => `
import { useEffect } from "react";
export const StoredObserver = ({ element, enabled }) => {
  useEffect(() => {
    let cleanupObserver = () => {};
    const observe = ${factoryExpression} {
      const observer = new IntersectionObserver(() => {});
      observer.observe(element);
      return () => observer.disconnect();
    };
    cleanupObserver = observe();
    ${doesConsumeFactory ? "cleanupObserver.next();" : ""}
    ${cleanup}
  }, [element, enabled]);
  return null;
};
`;

const safeCleanups: StoredDisposerCleanupCase[] = [
  {
    name: "direct const helper",
    cleanup: "const cleanup = () => cleanupObserver(); return () => cleanup();",
  },
  {
    name: "two closed helpers",
    cleanup:
      "const release = () => cleanupObserver(); const cleanup = () => release(); return () => cleanup();",
  },
  {
    name: "single statement block helper",
    cleanup: "const cleanup = () => { cleanupObserver(); }; return () => { cleanup(); };",
  },
  {
    name: "single return block helper",
    cleanup: "const cleanup = () => { return cleanupObserver(); }; return () => cleanup();",
  },
];

const unsafeCleanups: StoredDisposerCleanupCase[] = [
  { name: "uncalled helper", cleanup: "const cleanup = () => cleanupObserver(); return () => {};" },
  {
    name: "conditional call",
    cleanup: "const cleanup = () => cleanupObserver(); return () => { if (enabled) cleanup(); };",
  },
  {
    name: "conditional helper body",
    cleanup: "const cleanup = () => { if (enabled) cleanupObserver(); }; return () => cleanup();",
  },
  {
    name: "conditional return call",
    cleanup:
      "const cleanup = () => cleanupObserver(); return () => { if (enabled) return cleanup(); };",
  },
  {
    name: "nested conditional return",
    cleanup:
      "const cleanup = () => cleanupObserver(); return () => { if (enabled) { if (element) return cleanup(); } };",
  },
  {
    name: "early return before cleanup",
    cleanup:
      "const cleanup = () => cleanupObserver(); return () => { if (enabled) return; cleanup(); };",
  },
  {
    name: "throw before cleanup",
    cleanup:
      "const cleanup = () => cleanupObserver(); return () => { throw new Error('stop'); cleanup(); };",
  },
  {
    name: "deferred helper call",
    cleanup: "const cleanup = () => cleanupObserver(); return () => queueMicrotask(cleanup);",
  },
  {
    name: "escaped callable slot",
    cleanup:
      "const holder = { cleanup: () => cleanupObserver() }; publish(holder); return () => holder.cleanup();",
  },
  {
    name: "mutated helper",
    cleanup: "let cleanup = () => cleanupObserver(); cleanup = () => {}; return () => cleanup();",
  },
  {
    name: "async helper",
    cleanup:
      "const cleanup = async () => { await Promise.resolve(); cleanupObserver(); }; return () => cleanup();",
  },
  {
    name: "mutated call property",
    cleanup:
      "const cleanup = () => cleanupObserver(); cleanup.call = () => {}; return () => cleanup.call(null);",
  },
  { name: "recursive cycle", cleanup: "const cleanup = () => cleanup(); return () => cleanup();" },
  {
    name: "mutual recursive cycle",
    cleanup:
      "const release = () => cleanup(); const cleanup = () => release(); return () => cleanup();",
  },
  {
    name: "uninitialized helper after return",
    cleanup: "return () => cleanup(); const cleanup = () => cleanupObserver();",
  },
  {
    name: "shadowed helper",
    cleanup:
      "const cleanup = () => cleanupObserver(); return () => { const cleanup = () => {}; cleanup(); };",
  },
  {
    name: "stored disposer overwritten",
    cleanup:
      "const cleanup = () => cleanupObserver(); cleanupObserver = () => {}; return () => cleanup();",
  },
  {
    name: "direct eval can replace disposer",
    cleanup:
      "const cleanup = () => cleanupObserver(); eval('cleanupObserver = () => {}'); return () => cleanup();",
  },
];

const ruleCases: StoredDisposerRuleCase[] = [
  { name: "effect-needs-cleanup", rule: effectNeedsCleanup },
  { name: "effect-observer-needs-disconnect", rule: effectObserverNeedsDisconnect },
];

for (const { name: ruleName, rule } of ruleCases) {
  describe(`${ruleName} stored disposer cleanup helpers`, () => {
    it.each(safeCleanups)("accepts $name", ({ cleanup }) => {
      expect(runRule(rule, makeStoredObserverDisposerEffect(cleanup)).diagnostics).toEqual([]);
    });
    describe.each([
      "return () => cleanupObserver();",
      "const cleanup = () => cleanupObserver(); return () => cleanup();",
    ])("factory cleanup %s", (cleanup) => {
      it("reports async factories that publish promises", () => {
        expect(
          runRule(rule, makeStoredObserverDisposerEffect(cleanup, "async () =>")).diagnostics,
        ).toHaveLength(1);
      });
      it("does not report inert generators", () => {
        expect(
          runRule(rule, makeStoredObserverDisposerEffect(cleanup, "function* ()")).diagnostics,
        ).toEqual([]);
      });
      it("reports consumed generator leaks", () => {
        expect(
          runRule(rule, makeStoredObserverDisposerEffect(cleanup, "function* ()", true))
            .diagnostics,
        ).toHaveLength(1);
      });
    });
    it.each(unsafeCleanups)("reports $name", ({ cleanup }) => {
      expect(runRule(rule, makeStoredObserverDisposerEffect(cleanup)).diagnostics).toHaveLength(1);
    });
  });
}
