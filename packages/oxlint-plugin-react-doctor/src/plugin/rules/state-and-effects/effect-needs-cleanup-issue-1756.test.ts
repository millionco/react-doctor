import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1756", () => {
  it("accepts chained timers cleared by the returned cleanup helper", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect, useState } from "react";

      const STEPS = [0, 400, 800];

      const ChainedTimer = () => {
        const [frame, setFrame] = useState(0);
        const [loop, setLoop] = useState(0);
        useEffect(() => {
          let cancelled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          let index = 0;
          const startedAt = Date.now();
          const clearTimer = () => {
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const scheduleAt = (at: number, callback: () => void) => {
            timer = setTimeout(callback, Math.max(0, at - (Date.now() - startedAt)));
          };
          const advance = () => {
            timer = null;
            if (cancelled) return;
            setFrame(index);
            index += 1;
            if (index < STEPS.length) {
              scheduleAt(STEPS[index], advance);
            } else {
              scheduleAt(2000, () => {
                if (!cancelled) setLoop((count) => count + 1);
              });
            }
          };
          const onVisibilityChange = () => {
            if (cancelled) return;
            if (document.hidden) clearTimer();
            else setLoop((count) => count + 1);
          };
          document.addEventListener("visibilitychange", onVisibilityChange);
          if (!document.hidden) scheduleAt(STEPS[0], advance);
          return () => {
            cancelled = true;
            clearTimer();
            document.removeEventListener("visibilitychange", onVisibilityChange);
          };
        }, [loop]);
        return <span>{frame}</span>;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports timer handle overwrites before the previous timer fires", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const UnsafeTimers = () => {
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const schedule = () => {
            timer = setTimeout(() => {}, 1000);
          };
          schedule();
          schedule();
          return () => {
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts a guarded timer scheduled through a helper after an await", () => {
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
            if (!run.live) return;
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

  it("reports a helper timer scheduled after an await without a lifecycle guard", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function refresh(): Promise<void>;

      const UnsafeAsyncTimer = () => {
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const schedule = () => {
            timer = setTimeout(() => {}, 1000);
          };
          void (async () => {
            await refresh();
            schedule();
          })();
          return () => {
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("reports an interruption between the lifecycle guard and timer helper", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function refresh(): Promise<void>;

      const UnsafeInterruptedTimer = () => {
        useEffect(() => {
          const run = { live: true };
          let timer: ReturnType<typeof setTimeout> | null = null;
          const schedule = () => {
            timer = setTimeout(() => {}, 1000);
          };
          void (async () => {
            await refresh();
            if (!run.live) return;
            await refresh();
            schedule();
          })();
          return () => {
            run.live = false;
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("reports guarded async timer work started repeatedly by the effect", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function refresh(): Promise<void>;

      const UnsafeRepeatedAsyncTimer = () => {
        useEffect(() => {
          const run = { live: true };
          let timer: ReturnType<typeof setTimeout> | null = null;
          const schedule = () => {
            timer = setTimeout(() => {}, 1000);
          };
          for (let index = 0; index < 2; index += 1) {
            void (async () => {
              await refresh();
              if (!run.live) return;
              schedule();
            })();
          }
          return () => {
            run.live = false;
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts a listener released by an abort handler when cleanup aborts the controller", () => {
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

  it("reports an abort handler that removes a different listener", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      const UnsafeAbortTeardown = () => {
        useEffect(() => {
          const controller = new AbortController();
          const onChange = () => {};
          const otherHandler = () => {};
          document.addEventListener("visibilitychange", onChange);
          controller.signal.addEventListener("abort", () => {
            document.removeEventListener("visibilitychange", otherHandler);
          });
          return () => controller.abort();
        }, []);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
