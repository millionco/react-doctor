import { describe, expect, it } from "vite-plus/test";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";
import { runRule } from "../../../test-utils/run-rule.js";

describe("effect-needs-cleanup issue-1856", () => {
  it.each([
    [
      "conditional cleanup",
      `const observer = new ResizeObserver(() => {}); observer.observe(first); if (enabled) return () => observer.disconnect();`,
    ],
    [
      "conditional disconnect",
      `const observer = new ResizeObserver(() => {}); observer.observe(first); return () => { if (enabled) observer.disconnect(); };`,
    ],
    [
      "wrong unobserve target",
      `const observer = new ResizeObserver(() => {}); observer.observe(first); return () => observer.unobserve(second);`,
    ],
    [
      "partial unobserve",
      `const observer = new ResizeObserver(() => {}); observer.observe(first); observer.observe(second); return () => observer.unobserve(first);`,
    ],
    [
      "loop with one unobserve",
      `const observer = new ResizeObserver(() => {}); for (const target of targets) { if (!target) continue; observer.observe(target); } return () => observer.unobserve(first);`,
    ],
    [
      "loop with conditional cleanup",
      `const observer = new ResizeObserver(() => {}); for (const target of targets) { if (!target) continue; observer.observe(target); } if (enabled) return () => observer.disconnect();`,
    ],
    [
      "escaping helper",
      `let observer = null; const start = () => { observer = new ResizeObserver(() => {}); observer.observe(first); }; start(); register({start}); return () => observer?.disconnect();`,
    ],
  ])("reports %s", (_, effectBody) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      export function Example({ first, second, targets, enabled, register }) {
        useEffect(() => { ${effectBody} }, []);
        return null;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["missing cancellation", "", "", "", "start();"],
    ["wrong cancellation handle", "cancelAnimationFrame(otherFrame);", "", "", "start();"],
    ["conditional cancellation", "if (enabled) cancelAnimationFrame(frame);", "", "", "start();"],
    [
      "conditional cleanup return",
      "cancelAnimationFrame(frame);",
      "if (enabled) return;",
      "",
      "start();",
    ],
    ["two initial calls", "cancelAnimationFrame(frame);", "", "", "start(); start();"],
    [
      "initial call in a loop",
      "cancelAnimationFrame(frame);",
      "",
      "",
      "for (const target of targets) start();",
    ],
    ["escaping callback", "cancelAnimationFrame(frame);", "", "", "start(); register({ start });"],
    [
      "retry after observing",
      "cancelAnimationFrame(frame);",
      "",
      "frame = requestAnimationFrame(start);",
      "start();",
    ],
  ])(
    "reports observer retry with %s",
    (_, cancellation, beforeReturn, afterObserve, initialCall) => {
      const result = runRule(
        effectNeedsCleanup,
        `
      import { useEffect } from "react";
      export function Example({ enabled, otherFrame, targets, register }) {
        useEffect(() => {
          let observer = null;
          let frame = 0;
          const start = () => {
            frame = 0;
            const target = document.getElementById("target");
            if (!target) {
              frame = requestAnimationFrame(start);
              return;
            }
            observer = new ResizeObserver(() => {});
            observer.observe(target);
            ${afterObserve}
          };
          ${initialCall}
          ${beforeReturn}
          return () => { observer?.disconnect(); ${cancellation} };
        }, []);
        return null;
      }
    `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("accepts observer with observe calls in for-of loop over tuple array", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

const targets = [["first"], ["second"]] as const;

export function ObserveTupleLoop() {
  useEffect(() => {
    const observer = new IntersectionObserver(() => {});
    for (const [id] of targets) {
      const target = document.getElementById(id);
      if (!target) continue;
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts observer created in nested effect-invoked function with cleanup at effect level", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

export function RetryUntilTargetExists() {
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const start = () => {
      frame = 0;
      const target = document.getElementById("first");
      if (!target) {
        frame = requestAnimationFrame(start);
        return;
      }
      observer = new IntersectionObserver(() => {});
      observer.observe(target);
    };
    start();
    return () => {
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts observer with observe calls in for-of loop over regular array", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

export function ObserveMultipleTargets({ ids }) {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [ids]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts observer created and observed in nested function with simple cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

export function SimpleNestedObserver() {
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    const init = () => {
      const target = document.getElementById("target");
      if (!target) return;
      observer = new IntersectionObserver(() => {});
      observer.observe(target);
    };
    init();
    return () => {
      observer?.disconnect();
    };
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects observer with no cleanup even in for-of loop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

export function MissingCleanup({ ids }) {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }
  }, [ids]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects observer created in nested function with no cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";

export function NoCleanupNested() {
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    const init = () => {
      const target = document.getElementById("target");
      if (!target) return;
      observer = new IntersectionObserver(() => {});
      observer.observe(target);
    };
    init();
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
