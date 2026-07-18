import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { advancedEventHandlerRefs } from "./advanced-event-handler-refs.js";

describe("advanced-event-handler-refs — regressions", () => {
  it("stays silent when the handler has a stable useCallback identity", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C() {
        const onResize = useCallback(() => {}, []);
        useEffect(() => {
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, [onResize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when another dep is itself the subscription target", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ onMessage, socket }) {
        useEffect(() => {
          socket.on('message', onMessage);
          return () => socket.off('message', onMessage);
        }, [onMessage, socket]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a fresh unstable handler with no other deps", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ onResize }) {
        useEffect(() => {
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, [onResize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent for useEvent-wrapped handlers (mined ant-design useLocalStorage FP)", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function useLocalStorage(key) {
        const onNativeStorage = useEvent((event) => {
          syncState();
        });
        const onCustomStorage = useEvent((event) => {
          syncState();
        });
        useEffect(() => {
          window?.addEventListener('storage', onNativeStorage);
          window?.addEventListener('ant-sync', onCustomStorage);
          return () => {
            window?.removeEventListener('storage', onNativeStorage);
            window?.removeEventListener('ant-sync', onCustomStorage);
          };
        }, [onNativeStorage, onCustomStorage]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the other common stable-callback hook names", () => {
    for (const stableHookName of ["useEventCallback", "useMemoizedFn", "useStableCallback"]) {
      const result = runRule(
        advancedEventHandlerRefs,
        `function C() {
          const onScroll = ${stableHookName}(() => syncState());
          useEffect(() => {
            window.addEventListener('scroll', onScroll);
            return () => window.removeEventListener('scroll', onScroll);
          }, [onScroll]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("stays silent for a non-React useEffectEvent polyfill", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `import { useEffectEvent } from "@rocket.chat/fuselage-hooks";
      import { useEffect } from "react";
      function C() {
        const onScroll = useEffectEvent(() => syncState());
        useEffect(() => {
          window.addEventListener('scroll', onScroll);
          return () => window.removeEventListener('scroll', onScroll);
        }, [onScroll]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation r2: tracecat use-window-size (useThrottledCallback with
  // internal useMemo) and cloudscape collapsible-flashbar (useThrottleCallback
  // with `.cancel()` cleanup) — throttle/debounce wrapper hooks memoize
  // internally, so the handler identity doesn't churn per render, and the
  // ref-wrapper refactor would break the cancel lifecycle.
  it("stays silent for a useThrottledCallback-wrapped handler", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function useWindowSize() {
        const handleViewportChange = useThrottledCallback(() => syncState(), 200);
        useEffect(() => {
          window.visualViewport.addEventListener('resize', handleViewportChange);
          return () => window.visualViewport.removeEventListener('resize', handleViewportChange);
        }, [handleViewportChange]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a useThrottleCallback handler with cancel() cleanup", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function Flashbar({ isExpanded }) {
        const updateBottomSpacing = useThrottleCallback(() => sync(isExpanded), 100, [isExpanded]);
        useLayoutEffect(() => {
          window.addEventListener('resize', updateBottomSpacing);
          return () => {
            window.removeEventListener('resize', updateBottomSpacing);
            updateBottomSpacing.cancel();
          };
        }, [updateBottomSpacing]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a useDebouncedCallback-wrapped handler", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C() {
        const onScroll = useDebouncedCallback(() => syncState(), 150);
        useEffect(() => {
          window.addEventListener('scroll', onScroll);
          return () => window.removeEventListener('scroll', onScroll);
        }, [onScroll]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a handler built by a plain (non-stable-hook) call each render", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ delay }) {
        const onScroll = throttle(() => syncState(), delay);
        useEffect(() => {
          window.addEventListener('scroll', onScroll);
          return () => window.removeEventListener('scroll', onScroll);
        }, [onScroll]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent for React.useMemo(fn, []) handlers (mined ant-design AffixTabs FP)", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function AffixTabs() {
        const onSyncAffix = React.useMemo(() => {
          function doSync() {}
          return throttle(doSync);
        }, []);
        React.useEffect(() => {
          window.addEventListener('scroll', onSyncAffix);
          return () => window.removeEventListener('scroll', onSyncAffix);
        }, [onSyncAffix]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a useMemo handler whose non-empty deps churn its identity", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ delay }) {
        const onScroll = useMemo(() => throttle(() => syncState(), delay), [delay]);
        useEffect(() => {
          window.addEventListener('scroll', onScroll);
          return () => window.removeEventListener('scroll', onScroll);
        }, [onScroll]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an unstable prop param that shadows an outer stable binding", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `const onResize = useCallback(() => {}, []);
      function C({ onResize }) {
        useEffect(() => {
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, [onResize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the outer stable binding is NOT shadowed by a param", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `const onResize = stableCallback;
      function C() {
        const onResizeStable = useCallback(onResize, []);
        useEffect(() => {
          window.addEventListener('resize', onResizeStable);
          return () => window.removeEventListener('resize', onResizeStable);
        }, [onResizeStable]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a churning handler when the receiver dep is a stable useRef", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ onScroll }) {
        const ref = useRef(null);
        useEffect(() => {
          ref.current.addEventListener('scroll', onScroll);
          return () => ref.current.removeEventListener('scroll', onScroll);
        }, [onScroll, ref]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the receiver dep is an unstable local, not a ref", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ onMessage, channelId }) {
        const channel = getChannel(channelId);
        useEffect(() => {
          channel.addEventListener('message', onMessage);
          return () => channel.removeEventListener('message', onMessage);
        }, [onMessage, channel]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
