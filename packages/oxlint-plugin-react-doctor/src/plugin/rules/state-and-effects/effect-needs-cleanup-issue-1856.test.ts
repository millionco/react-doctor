import { describe, expect, it } from "vite-plus/test";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";
import { runRule } from "../../../test-utils/run-rule.js";

describe("effect-needs-cleanup issue-1856", () => {
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
