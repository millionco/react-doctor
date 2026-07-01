import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

describe("no-side-effect-in-state-updater-function", () => {
  it("flags a consumer callback inside a nested map updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setCurrentEvents((prev) =>
        prev.map((event) => {
          if (event.id !== id) return event;
          const newEvent = { ...event, ...changes };
          onEventUpdate?.(newEvent);
          return newEvent;
        }),
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an analytics call inside a block-body updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setSelectedRows((prev) => {
        const next = toggleRow(prev, rowId);
        trackAnalytics('row_selected', { rowId });
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an on*-named callback before returning next state", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== sessionId);
        onSessionsChange(updated);
        return updated;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a side effect inside a dispatch updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `dispatch((prev) => {
        const next = { ...prev, open: true };
        logEvent('opened');
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a pure Set builder updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setSelectedRows((prev) => {
        const next = new Set(prev);
        next.delete(rowId);
        next.add(newId);
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a pure array transform updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setItems((prev) => {
        const next = prev.map((item) => ({ ...item, dirty: false }));
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a pure lookup helper updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setState((prev) => {
        const match = prev.find((entry) => entry.id === id);
        return match ? applyChange(prev, match) : prev;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nested setter alone (not a side effect)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setState((prev) => {
        const next = { ...prev };
        setOther(next);
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not misattribute a callback in a setInterval lambda to a nested setter", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setInterval(() => {
        setCountdown((prev) => prev - 1);
        onClose();
        return;
      }, 1000);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a concise-body updater with no interleaved statement", () => {
    const result = runRule(noSideEffectInStateUpdaterFunction, `setCount((prev) => prev + 1);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a consumer callback invoked outside the updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const handle = (value) => {
        onChange?.(value);
        setState((prev) => {
          const next = compute(prev, value);
          return next;
        });
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the callback is passed to a non-setter call", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `items.reduce((prev, item) => {
        onChange(item);
        return prev.concat(item);
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
