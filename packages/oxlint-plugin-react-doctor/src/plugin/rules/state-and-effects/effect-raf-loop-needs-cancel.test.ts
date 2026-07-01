import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectRafLoopNeedsCancel } from "./effect-raf-loop-needs-cancel.js";

describe("effect-raf-loop-needs-cancel", () => {
  it("flags a named self-rescheduling loop with no cancel", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          let id;
          const loop = () => {
            tick();
            id = requestAnimationFrame(loop);
          };
          id = requestAnimationFrame(loop);
        }, []);
        return null;
      }
      `
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline self-rescheduling loop", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          requestAnimationFrame(function tick() {
            update();
            requestAnimationFrame(tick);
          });
        }, []);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a loop that cancels in cleanup", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Countdown() {
        useEffect(() => {
          let requestId;
          const loop = () => {
            render();
            requestId = requestAnimationFrame(loop);
          };
          requestId = requestAnimationFrame(loop);
          return () => cancelAnimationFrame(requestId);
        }, []);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-shot requestAnimationFrame", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Following() {
        useEffect(() => {
          requestAnimationFrame(() => scrollToTop());
        }, []);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when cancellation is delegated via an aliased handle in cleanup", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          const { cancelAnimationFrame: cancel } = window;
          let id;
          const loop = () => {
            tick();
            id = requestAnimationFrame(loop);
          };
          id = requestAnimationFrame(loop);
          return () => cancel(id);
        }, []);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a throttle that schedules a non-rescheduling frame", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Scroller() {
        useEffect(() => {
          let ticking = false;
          const onScroll = () => {
            if (!ticking) {
              requestAnimationFrame(() => {
                doWork();
                ticking = false;
              });
              ticking = true;
            }
          };
          window.addEventListener('scroll', onScroll);
          return () => window.removeEventListener('scroll', onScroll);
        }, []);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a rAF-free effect", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
