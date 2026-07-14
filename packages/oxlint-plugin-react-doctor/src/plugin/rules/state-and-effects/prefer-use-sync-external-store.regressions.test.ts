// Locks the module-scope hand-rolled store detection (RD-FN-061): a
// module-level mutable snapshot binding + listener registry + same-file
// subscribe function, consumed as `useState(sharedState)` +
// `useEffect(() => subscribe(setState), [])`. Publishes fired between the
// render-time snapshot and the effect-time subscription are lost, and
// concurrent renders can tear — `useSyncExternalStore` is the fix.

import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseSyncExternalStore } from "./prefer-use-sync-external-store.js";

const run = (code: string) => runRule(preferUseSyncExternalStore, code);

const MODULE_STORE_PREAMBLE = `
import { useEffect, useState } from "react";

let sharedPushState = "default";
const pushStateListeners = new Set();

function publishPushState(next) {
  sharedPushState = next;
  for (const listener of pushStateListeners) listener(next);
}

function subscribePushState(listener) {
  pushStateListeners.add(listener);
  return () => {
    pushStateListeners.delete(listener);
  };
}
`;

describe("prefer-use-sync-external-store — module-scope store shape", () => {
  it("stays silent when a subscription callback is received as a custom-hook parameter", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export function useForwardedSubscription(subscribe) {
  const [state, setState] = useState("default");
  useEffect(() => subscribe(setState), []);
  return state;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags useState(sharedState) + useEffect(() => subscribe(setState), []) (ground-truth shape)", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export function usePushSubscription() {
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    return subscribePushState(setState);
  }, []);
  return state;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("sharedPushState");
  });

  it("flags the shape with extra hydration work before the subscription", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
let hydrateStarted = false;
function ensurePushStateHydrated() {
  if (hydrateStarted) return;
  hydrateStarted = true;
}

export function usePushSubscription() {
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    ensurePushStateHydrated();
    return subscribePushState(setState);
  }, []);
  return state;
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a lazy snapshot initializer useState(() => sharedState)", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export const StatusBadge = () => {
  const [state, setState] = useState(() => sharedPushState);
  useEffect(() => {
    const unsubscribe = subscribePushState(setState);
    return unsubscribe;
  }, []);
  return <span>{state}</span>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a thin closure over the setter passed to subscribe", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export const StatusBadge = () => {
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    return subscribePushState((next) => setState(next));
  }, []);
  return <span>{state}</span>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an array-backed listener registry registered via push", () => {
    const result = run(
      `import { useEffect, useState } from "react";
let currentTheme = "light";
const themeListeners = [];
const subscribeTheme = (listener) => {
  themeListeners.push(listener);
  return () => {
    const index = themeListeners.indexOf(listener);
    if (index >= 0) themeListeners.splice(index, 1);
  };
};
export const ThemeLabel = () => {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => subscribeTheme(setTheme), []);
  return <span>{theme}</span>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag genuine useSyncExternalStore usage over the same store", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
import { useSyncExternalStore } from "react";
export function usePushSubscription() {
  return useSyncExternalStore(
    subscribePushState,
    () => sharedPushState,
    () => "default",
  );
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a module const config value as initial state", () => {
    const result = run(
      `import { useEffect, useState } from "react";
const defaultFilters = "all";
const filterListeners = new Set();
const subscribeFilters = (listener) => {
  filterListeners.add(listener);
  return () => filterListeners.delete(listener);
};
export const FilterBar = () => {
  const [filters, setFilters] = useState(defaultFilters);
  useEffect(() => subscribeFilters(setFilters), []);
  return <span>{filters}</span>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an imported subscribe function (cross-file store is a v1 non-goal)", () => {
    const result = run(
      `import { useEffect, useState } from "react";
import { subscribePushState } from "./push-store";
let sharedPushState = "default";
export function usePushSubscription() {
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    return subscribePushState(setState);
  }, []);
  return state;
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag when the effect has non-empty dependencies", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export function usePushSubscription({ channelId }) {
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    return subscribePushState(setState);
  }, [channelId]);
  return state;
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag when the setter is not the one forwarded to subscribe", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export function usePushSubscription() {
  const [state, setState] = useState(sharedPushState);
  const [, setTick] = useState(0);
  useEffect(() => {
    return subscribePushState(() => setTick((tick) => tick + 1));
  }, []);
  return state;
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a component-local shadow of the module store binding", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export function usePushSubscription({ initial }) {
  const sharedPushState = initial;
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    return subscribePushState(setState);
  }, []);
  return state;
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a subscribe-named function that never registers its parameter", () => {
    const result = run(
      `import { useEffect, useState } from "react";
let sharedFlag = false;
const listeners = new Set();
function subscribeAnalytics(eventName) {
  queueMicrotask(() => console.log(eventName));
}
export const Banner = () => {
  const [flag, setFlag] = useState(sharedFlag);
  useEffect(() => {
    subscribeAnalytics(setFlag);
  }, []);
  return flag ? <div /> : null;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag setState registered with a DOM event target instead of the store", () => {
    const result = run(
      `import { useEffect, useState } from "react";
let lastKnownWidth = 0;
export const WidthLabel = () => {
  const [width, setWidth] = useState(lastKnownWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return <span>{width}</span>;
};`,
    );
    // The member-call path may or may not match this DOM-listener shape,
    // but the module-store path must not: there is no same-file subscribe
    // function registering its parameter into a listener registry.
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).not.toContain("module store");
    }
  });

  it("does not flag a literal UI-state reset on browser events (setLoading(false) on focus)", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export const PortalButton = () => {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const reset = () => setLoading(false);
    window.addEventListener("focus", reset);
    return () => window.removeEventListener("focus", reset);
  }, []);
  return <button disabled={loading}>Open portal</button>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an event-bus toggle whose setter forwards a bare literal", () => {
    const result = run(
      `import { useEffect, useState } from "react";
import EventEmitter from "events";
const emitter = new EventEmitter();
export const useExpand = () => {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const hide = () => setExpanded(false);
    emitter.on("hide", hide);
    return () => emitter.off("hide", hide);
  }, []);
  return expanded;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a snapshot-reading resync in a custom hook (window.innerHeight)", () => {
    const result = run(
      `import { useEffect, useState } from "react";
export function useWindowHeight() {
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return windowHeight;
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a resync handler written as a block-bodied return", () => {
    const result = run(
      `import { useEffect, useState } from "react";
const WidthLabel = () => {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => { return (setWidth(window.innerWidth)); };
    window.addEventListener("resize", onResize);
    return () => { return (window.removeEventListener("resize", onResize)); };
  }, []);
  return <span>{width}</span>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports once when two effects subscribe the same setter", () => {
    const result = run(
      `${MODULE_STORE_PREAMBLE}
export function usePushSubscription() {
  const [state, setState] = useState(sharedPushState);
  useEffect(() => {
    return subscribePushState(setState);
  }, []);
  useEffect(() => {
    return subscribePushState(setState);
  }, []);
  return state;
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
