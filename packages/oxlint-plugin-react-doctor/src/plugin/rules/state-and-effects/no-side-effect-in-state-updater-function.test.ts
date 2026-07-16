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

  it("flags a logging call inside a block-body setter updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setDialog((prev) => {
        const next = { ...prev, open: true };
        logEvent('opened');
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an &&-guarded consumer callback like the equivalent if statement", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== sessionId);
        updated.length !== prev.length && onSessionsChange(updated);
        return updated;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an analytics call inside a synchronously invoked forEach callback", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setItems((prev) => {
        const next = [...prev];
        next.forEach((item) => {
          trackView(item.id);
        });
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a deferred dismiss handler stored on the next state (toast onDismiss idiom)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setToasts((prev) => prev.concat({
        id,
        dismiss: () => {
          onDismiss?.(id);
          return true;
        },
      }));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a deferred column sorter stored in a block-body updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setColumns((prev) => {
        const next = prev.map((column) => ({
          ...column,
          sort: () => {
            onSort?.(column.id);
            return column.id;
          },
        }));
        return next;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a redux-thunk passed to dispatch (dispatch is not a React updater)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `dispatch(async (dispatch, getState) => {
        const settings = getState().settings;
        const saved = await api.save(settings);
        onSaved?.(saved);
        return saved;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: Deferred handler stored in a Map via next.set(key, fn)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setShortcuts((prev) => {
  const next = new Map(prev);
  next.set(combo, () => {
    onShortcut?.(combo);
  });
  return next;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Deferred undo thunk stored via next.push(fn)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setUndoStack((prev) => {
  const next = [...prev];
  next.push(() => {
    onUndo?.(entry.id);
  });
  return next;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Toast dismiss handler routed through a factory helper", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setToasts((prev) => {
  const next = prev.concat(
    createToast(id, () => {
      onDismiss?.(id);
    }),
  );
  return next;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Debounced handler stored in state (double-lambda updater)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setSearchHandler(() => {
  const handler = debounce((query) => {
    onSearch?.(query);
  }, 300);
  return handler;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Pure local board mutation helper named capture* (chess)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setBoard((prev) => {
  const next = prev.map((rank) => [...rank]);
  capturePiece(next, move.to);
  return next;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Pure local clone mutation helper matching /callback/i", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setRegistry((prev) => {
  const next = { ...prev, callbacks: new Map(prev.callbacks) };
  pruneExpiredCallbacks(next.callbacks, now);
  return next;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Pure local append helper named log* (move history)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setHistory((prev) => {
  const next = [...prev];
  logMove(next, move);
  return next;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: react-router setSearchParams functional updater (eager, invoked exactly once)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import { useSearchParams } from "react-router-dom";

const FilterBar = ({ onFilterApplied }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const applyCategory = (category) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("category", category);
      onFilterApplied?.(category);
      return next;
    });
  };
  return <button onClick={() => applyCategory("books")}>Books</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Vanilla external-store setter in a plain .ts module (useSyncExternalStore backend)", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `interface ThemeState { mode: "light" | "dark"; }
let themeState: ThemeState = { mode: "light" };
const listeners = new Set<() => void>();

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getSnapshot = () => themeState;

const setThemeState = (updater: (prev: ThemeState) => ThemeState) => {
  themeState = updater(themeState);
  listeners.forEach((listener) => listener());
};

export const toggleMode = (onModeChange?: (mode: string) => void) => {
  setThemeState((prev) => {
    const next: ThemeState = { mode: prev.mode === "light" ? "dark" : "light" };
    onModeChange?.(next.mode);
    return next;
  });
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a consumer callback fired inside a map during the updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setRows((prev) => {
         const next = prev.map((row) => {
           onRowVisited?.(row.id);
           return { ...row, seen: true };
         });
         return next;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an analytics call over non-local data before the return", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `setCount((prev) => {
         trackEvent("increment", prev);
         return prev + 1;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
