import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1594", () => {
  it("accepts a ref timer allocated and released through effect-local helpers", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const Status = ({ online }) => {
        useEffect(() => {
          const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

          const clearOfflineTimer = () => {
            if (timerRef.current) {
              clearTimeout(timerRef.current);
              timerRef.current = null;
            }
          };

          const applyState = (nextOnline: boolean) => {
            if (!nextOnline && !timerRef.current) {
              timerRef.current = setTimeout(() => updateStatus(), 1_000);
            }
          };

          applyState(online);
          return () => {
            clearOfflineTimer();
          };
        }, [online]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts the same ownership through nested cleanup helpers", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const Status = ({ online }) => {
        useEffect(() => {
          const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
          const releaseTimer = () => clearTimeout(timerRef.current);
          const clearOfflineTimer = () => releaseTimer();
          const applyState = () => {
            timerRef.current = setTimeout(() => updateStatus(), 1_000);
          };

          applyState();
          return () => clearOfflineTimer();
        }, [online]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a ref timer allocated by an effect-owned subscription callback", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const Status = ({ source }) => {
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
              timerRef.current = setTimeout(() => updateStatus(), 1_000);
            }
          };

          const unsubscribe = source.subscribe((online) => applyState(online));
          return () => {
            clearOfflineTimer();
            unsubscribe();
          };
        }, [source]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a ref timer that a promise callback can allocate after teardown", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const Status = ({ source }) => {
        useEffect(() => {
          const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
          const clearOfflineTimer = () => clearTimeout(timerRef.current);
          const applyState = (online: boolean) => {
            if (!online) timerRef.current = setTimeout(() => updateStatus(), 1_000);
          };

          source.read().then((online) => applyState(online));
          return () => clearOfflineTimer();
        }, [source]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a cleanup helper that releases a different timer", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const Status = ({ online }) => {
        useEffect(() => {
          const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
          const otherTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
          const clearOfflineTimer = () => clearTimeout(otherTimerRef.current);
          const applyState = () => {
            timerRef.current = setTimeout(() => updateStatus(), 1_000);
          };

          applyState();
          return () => clearOfflineTimer();
        }, [online]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a cleanup helper skipped on one teardown path", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const Status = ({ online, shouldRelease }) => {
        useEffect(() => {
          const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
          const clearOfflineTimer = () => clearTimeout(timerRef.current);
          const applyState = () => {
            timerRef.current = setTimeout(() => updateStatus(), 1_000);
          };

          applyState();
          return () => {
            if (shouldRelease) clearOfflineTimer();
          };
        }, [online, shouldRelease]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
