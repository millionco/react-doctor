import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1756", () => {
  describe("chained timer cleared by helper", () => {
    it("accepts a timer that is reassigned multiple times and cleared by a helper", () => {
      const result = runEffectNeedsCleanup(`
        import { useEffect, useState } from "react";

        const ChainedTimer = () => {
          const [frame, setFrame] = useState(0);
          useEffect(() => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            
            const clearTimer = () => {
              if (timer !== null) {
                clearTimeout(timer);
                timer = null;
              }
            };
            
            const scheduleNext = (delay: number) => {
              timer = setTimeout(() => {
                timer = null;
                setFrame(f => f + 1);
                // Chain to next timer
                timer = setTimeout(() => setFrame(10), 1000);
              }, delay);
            };
            
            scheduleNext(500);
            
            return () => {
              clearTimer();
            };
          }, []);
          return <div>{frame}</div>;
        };
      `);

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("timer scheduled after await with guard", () => {
    it("accepts a timer allocated in a nested function called after an await, with a guard before the call", () => {
      const result = runEffectNeedsCleanup(`
        import { useEffect, useState } from "react";
        
        declare function refresh(): Promise<"refreshed" | "invalid">;

        const AsyncBoundedTimer = () => {
          const [unproven, setUnproven] = useState(false);
          useEffect(() => {
            const run = { live: true };
            let settleTimer: ReturnType<typeof setTimeout> | null = null;
            
            const refreshAndBound = () => {
              settleTimer = setTimeout(() => {
                settleTimer = null;
                if (run.live) setUnproven(true);
              }, 4000);
            };
            
            void (async () => {
              const outcome = await refresh();
              if (!run.live) return;  // Guard prevents allocation after teardown
              if (outcome === "refreshed") {
                refreshAndBound();
                return;
              }
              setUnproven(true);
            })();
            
            return () => {
              run.live = false;
              if (settleTimer !== null) clearTimeout(settleTimer);
            };
          }, []);
          return <span>{String(unproven)}</span>;
        };
      `);

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("AbortController-based listener cleanup", () => {
    it("accepts a listener removed by an abort event handler when the cleanup calls abort()", () => {
      const result = runEffectNeedsCleanup(`
        import { useEffect, useState } from "react";

        const AbortTeardown = () => {
          const [visible, setVisible] = useState(true);
          useEffect(() => {
            const controller = new AbortController();
            const { signal } = controller;
            const onChange = () => setVisible(!document.hidden);
            
            document.addEventListener("visibilitychange", onChange);
            
            signal.addEventListener(
              "abort",
              () => {
                document.removeEventListener("visibilitychange", onChange);
              },
              { once: true },
            );
            
            return () => {
              controller.abort();
            };
          }, []);
          return <span>{visible ? "visible" : "hidden"}</span>;
        };
      `);

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
