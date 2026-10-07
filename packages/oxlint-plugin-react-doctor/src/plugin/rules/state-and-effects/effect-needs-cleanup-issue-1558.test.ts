import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup issue 1558 cleanup ownership", () => {
  it.each([
    ["returned disposer", "return unsubscribe;"],
    ["invoked disposer", "return () => unsubscribe();"],
  ])("accepts a plain-function subscription %s", (_, cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function NetworkStatus({ NetInfo }) {
        useEffect(() => {
          const unsubscribe = NetInfo.addEventListener((state) => update(state));
          ${cleanup}
        }, [NetInfo]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts timer cleanup delegated to an effect-local helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function AppStateWatchdog({ AppState, done }) {
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 30_000);
          };
          const subscription = AppState.addEventListener("change", (state) =>
            state === "active" ? arm() : disarm(),
          );
          arm();
          return () => {
            disarm();
            subscription.remove();
          };
        }, [AppState, done]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "unsubscribers.forEach((unsubscribe) => unsubscribe());",
    "for (const unsubscribe of unsubscribers) unsubscribe();",
  ])("accepts array-collected disposer cleanup through %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Tabs({ tabs, onPress }) {
        useEffect(() => {
          const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", onPress));
          return () => {
            ${cleanup}
          };
        }, [tabs, onPress]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts cleanup split across an owned object and subscription", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function PauseResume({ AppState, onPause, onResume }) {
        useEffect(() => {
          const coalescer = createPauseResumeCoalescer({ onPause, onResume });
          const subscription = AppState.addEventListener("change", coalescer.handle);
          return () => {
            subscription.remove();
            coalescer.dispose();
          };
        }, [AppState, onPause, onResume]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a timer released only by a sibling unmount effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useLayoutEffect, useRef } from "react";
      function Poster({ videoId, onPosterTimeout }) {
        const watchdogRef = useRef(null);
        useLayoutEffect(() => {
          watchdogRef.current = setTimeout(onPosterTimeout, 4000);
        }, [videoId, onPosterTimeout]);
        useEffect(() => {
          return () => {
            if (watchdogRef.current) clearTimeout(watchdogRef.current);
          };
        }, []);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it.each([
    ["a legacy listener", "mediaQueryList.addListener(onChange)"],
    ["a subscription object", 'AppState.addEventListener("change", onChange)'],
    ["an event emitter", 'server.addListener("request", onChange)'],
  ])("does not assume %s returns a callable cleanup", (_, registration) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Listener({ AppState, mediaQueryList, onChange, server }) {
        useEffect(() => {
          const cleanup = ${registration};
          return cleanup;
        }, [AppState, mediaQueryList, onChange, server]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["prop", "", "navigation"],
    ["hook alias", 'import { useNavigation } from "@react-navigation/native";', "useNavigation()"],
    ["parent navigator", "", "navigation.getParent()"],
  ])("accepts a React Navigation disposer from a %s", (_, extraImport, receiver) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      ${extraImport}
      function NavigationListener({ navigation, onFocus }) {
        const appNavigation = ${receiver};
        useEffect(() => {
          const unsubscribe = appNavigation.addListener("focus", onFocus);
          return unsubscribe;
        }, [appNavigation, onFocus]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an aliased NetInfo default import", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      import NetworkInformation from "@react-native-community/netinfo";
      function NetworkStatus({ onChange }) {
        useEffect(() => {
          const unsubscribe = NetworkInformation.addEventListener(onChange);
          return unsubscribe;
        }, [onChange]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["unsubscribe();", "unsubscribe?.();"])(
    "accepts an explicitly invoked plain-function disposer through %s",
    (cleanup) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
        function EmitterValue({ emitter, onValue }) {
          useEffect(() => {
            const unsubscribe = emitter.on(onValue);
            return () => {
              ${cleanup}
            };
          }, [emitter, onValue]);
          return null;
        }`,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("accepts a guarded timer helper used by a named owned listener", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ AppState, done }) {
        useEffect(() => {
          let timer = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 1000);
          };
          const onChange = () => arm();
          const subscription = AppState.addEventListener("change", onChange);
          arm();
          return () => {
            disarm();
            subscription.remove();
          };
        }, [AppState, done]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an armed timer when an effect exit omits cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ done, enabled }) {
        useEffect(() => {
          let timer = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 1000);
          };
          arm();
          if (!enabled) return;
          return () => disarm();
        }, [done, enabled]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it("accepts a timer armed only on a path that returns cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ done, enabled }) {
        useEffect(() => {
          let timer = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 1000);
          };
          if (!enabled) return;
          arm();
          return () => disarm();
        }, [done, enabled]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports conditional direct timer cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ done, enabled }) {
        useEffect(() => {
          let timer = null;
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 1000);
          };
          arm();
          return () => {
            if (enabled) clearTimeout(timer);
          };
        }, [done, enabled]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it("reports a synchronously invoked timer helper retained by an unreleased listener", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ AppState, done }) {
        useEffect(() => {
          let timer = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 1000);
          };
          const onChange = () => arm();
          onChange();
          AppState.addEventListener("change", onChange);
          return () => disarm();
        }, [AppState, done]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("setTimeout"))).toBe(
      true,
    );
  });

  it("accepts a synchronously invoked timer helper retained by a released listener", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ AppState, done }) {
        useEffect(() => {
          let timer = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            if (timer != null) return;
            timer = setTimeout(done, 1000);
          };
          const onChange = () => arm();
          onChange();
          const subscription = AppState.addEventListener("change", onChange);
          return () => {
            disarm();
            subscription.remove();
          };
        }, [AppState, done]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["an unowned callback", "scheduleAgain(arm);", "subscription.remove();"],
    ["an async listener", "", "subscription.remove();", "async () => arm()"],
    ["an unreleased listener", "", "", "() => arm()"],
  ])(
    "reports a timer helper reachable from %s",
    (_, extraSetup, subscriptionCleanup, listener = "() => arm()") => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
        function Watchdog({ AppState, done, scheduleAgain }) {
          useEffect(() => {
            let timer = null;
            const disarm = () => {
              if (timer != null) {
                clearTimeout(timer);
                timer = null;
              }
            };
            const arm = () => {
              if (timer != null) return;
              timer = setTimeout(done, 1000);
            };
            const subscription = AppState.addEventListener("change", ${listener});
            arm();
            ${extraSetup}
            return () => {
              disarm();
              ${subscriptionCleanup}
            };
          }, [AppState, done, scheduleAgain]);
          return null;
        }`,
      );

      expect(result.parseErrors).toEqual([]);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes("setTimeout")),
      ).toBe(true);
    },
  );

  it.each([
    ["without a live-handle guard", "", "disarm();"],
    ["with conditional cleanup", "if (timer != null) return;", "if (enabled) disarm();"],
  ])("reports a timer helper %s", (_, guard, timerCleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Watchdog({ AppState, done, enabled }) {
        useEffect(() => {
          let timer = null;
          const disarm = () => {
            if (timer != null) {
              clearTimeout(timer);
              timer = null;
            }
          };
          const arm = () => {
            ${guard}
            timer = setTimeout(done, 1000);
          };
          const subscription = AppState.addEventListener("change", () => arm());
          arm();
          return () => {
            ${timerCleanup}
            subscription.remove();
          };
        }, [AppState, done, enabled]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it.each([
    [
      "an early exit",
      `for (const unsubscribe of unsubscribers) {
        unsubscribe();
        break;
      }`,
    ],
    [
      "collection mutation",
      `unsubscribers.pop();
      for (const unsubscribe of unsubscribers) unsubscribe();`,
    ],
    [
      "conditional forEach cleanup",
      "unsubscribers.forEach((unsubscribe) => { if (enabled) unsubscribe(); });",
    ],
    [
      "outer conditional forEach cleanup",
      "if (enabled) unsubscribers.forEach((unsubscribe) => unsubscribe());",
    ],
    [
      "outer conditional for-of cleanup",
      `if (enabled) {
        for (const unsubscribe of unsubscribers) unsubscribe();
      }`,
    ],
  ])("reports array-collected disposers with %s", (_, cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Tabs({ enabled, onPress, tabs }) {
        useEffect(() => {
          const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", onPress));
          return () => {
            ${cleanup}
          };
        }, [enabled, onPress, tabs]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addListener");
  });
});
