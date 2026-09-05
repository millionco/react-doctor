import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1756", () => {
  describe("chained timer cleared by helper", () => {
    // TODO: The rule currently doesn't recognize that when a timer handle is
    // reassigned inside its own callback (chained timers), the cleanup helper
    // still correctly clears whatever value is currently in the handle variable.
    // At any point there's only one active timer. Need to extend the rule to
    // understand mutable handle semantics where `clearTimeout(timer)` clears
    // the current value regardless of reassignments.
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
    // TODO: The rule recognizes guards INSIDE promise callbacks (issue #1241),
    // but doesn't track guards in the async caller that protect calls to sync
    // functions containing allocations. Need to extend guard tracking to
    // understand that `if (!run.live) return; refreshAndBound()` prevents
    // allocation in refreshAndBound() after teardown.
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
    // TODO: The rule recognizes direct `{signal}` usage, but doesn't recognize
    // the delegated pattern where signal.addEventListener("abort", ...) removes
    // the listener and cleanup calls controller.abort(). Need to add logic to
    // detect this event-based delegation: verify the abort handler removes the
    // correct listener, and cleanup calls abort() on the controller.
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
