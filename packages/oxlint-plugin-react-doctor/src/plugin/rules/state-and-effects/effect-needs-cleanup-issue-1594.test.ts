import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup issue #1594 - timer cleaned via helper in cleanup return", () => {
  it("should not flag setTimeout when cleared via a helper called from cleanup return", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const GRACE_MS = 1000;
export const Component = () => {
  useEffect(() => {
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

    const clearOfflineTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const applyState = (online: boolean) => {
      if (!online && !timerRef.current) {
        timerRef.current = setTimeout(() => {}, GRACE_MS);
      }
    };

    applyState(false);

    return () => {
      clearOfflineTimer();
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("should not flag setTimeout with useRef when cleared via helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Component = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const applyState = (online) => {
      if (!online && !timerRef.current) {
        timerRef.current = setTimeout(() => {}, 1000);
      }
    };

    applyState(false);

    return () => {
      clearTimer();
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
