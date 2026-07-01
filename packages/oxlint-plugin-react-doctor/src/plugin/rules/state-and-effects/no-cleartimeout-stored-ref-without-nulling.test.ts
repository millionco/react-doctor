import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCleartimeoutStoredRefWithoutNulling } from "./no-cleartimeout-stored-ref-without-nulling.js";

describe("no-cleartimeout-stored-ref-without-nulling", () => {
  it("flags a cleared-not-nulled ref read as pending-state elsewhere", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const Tooltip = () => {
        const timeout = useRef(null);
        const hide = () => {
          if (timeout.current) {
            clearTimeout(timeout.current);
          }
        };
        const show = () => {
          if (timeout.current) {
            return;
          }
          timeout.current = setTimeout(() => { setShow(true); }, delay);
        };
        return null;
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hover-intent ref cleared at leave, guarded at enter", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const HoverCard = () => {
        const openTimerRef = useRef(null);
        const onLeave = () => {
          clearTimeout(openTimerRef.current);
        };
        const onEnter = () => {
          if (openTimerRef.current) return;
          openTimerRef.current = setTimeout(open, delay);
        };
        return null;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for the guard-then-clear-then-reassign debounce idiom", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const useIdle = (timeout) => {
        const timer = useRef(-1);
        const handleEvents = () => {
          setIdle(false);
          if (timer.current) {
            window.clearTimeout(timer.current);
          }
          timer.current = window.setTimeout(() => setIdle(true), timeout);
        };
        return null;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the single-block debounce clear-then-reassign", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const useDebounce = (fn, wait) => {
        const timeoutRef = useRef();
        const debounced = (...args) => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => fn(...args), wait);
        };
        return debounced;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the clear has no downstream pending-state guard", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const useHover = () => {
        const timeoutRef = useRef(null);
        const cleanup = () => {
          clearTimeout(timeoutRef.current);
        };
        return cleanup;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the ref is nulled right after clearing", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const Tooltip = () => {
        const t = useRef(null);
        const hide = () => {
          if (t.current) {
            clearTimeout(t.current);
            t.current = null;
          }
        };
        const show = () => {
          if (t.current) return;
          t.current = setTimeout(() => setShow(true), 100);
        };
        return null;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the scheduler callback nulls the ref on completion", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const Tooltip = () => {
        const t = useRef(null);
        const hide = () => { clearTimeout(t.current); };
        const show = () => {
          if (t.current) return;
          t.current = setTimeout(() => { setShow(true); t.current = null; }, 100);
        };
        return null;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the handle is a plain variable, not a ref field", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const hide = () => {
        clearTimeout(timer);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the ref is not initialized by useRef", () => {
    const result = runRule(
      noCleartimeoutStoredRefWithoutNulling,
      `const run = () => {
        const timeout = { current: null };
        const hide = () => { clearTimeout(timeout.current); };
        const show = () => {
          if (timeout.current) return;
          timeout.current = setTimeout(() => setShow(true), 100);
        };
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
