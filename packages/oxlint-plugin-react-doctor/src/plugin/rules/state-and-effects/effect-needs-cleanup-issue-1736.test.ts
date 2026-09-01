import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1736 reproduction", () => {
  it("case 4: timer created in event handler, cleared in cleanup via helper", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      export function TeardownViaHelper() {
        useEffect(() => {
          let rafId: number | null = null;
          let resumeTimer: ReturnType<typeof setTimeout> | null = null;

          const stopAutoScroll = () => {
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
          };

          const onEvent = () => {
            resumeTimer = setTimeout(() => {
              rafId = requestAnimationFrame(() => {});
            }, 1500);
          };

          const events = ["scroll", "pointerdown", "keydown"] as const;
          for (const name of events) {
            window.addEventListener(name, onEvent, { passive: true });
          }

          return () => {
            for (const name of events) {
              window.removeEventListener(name, onEvent);
            }
            stopAutoScroll();
            if (resumeTimer) clearTimeout(resumeTimer);
          };
        }, []);

        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    console.log("Diagnostics:", result.diagnostics);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("simplified: timer in handler, cleared directly", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      export function SimplifiedCase() {
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | null = null;

          const onEvent = () => {
            timer = setTimeout(() => {}, 1000);
          };

          window.addEventListener("click", onEvent);

          return () => {
            window.removeEventListener("click", onEvent);
            if (timer) clearTimeout(timer);
          };
        }, []);

        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    console.log("Simplified diagnostics:", result.diagnostics);
    expect(result.diagnostics).toHaveLength(0);
  });
});
