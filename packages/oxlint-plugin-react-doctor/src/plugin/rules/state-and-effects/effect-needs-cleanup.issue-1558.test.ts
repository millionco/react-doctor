import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const validCases: ReadonlyArray<readonly [string, string]> = [
  [
    "returns an imported addEventListener disposer",
    `import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(() => {});
    return unsubscribe;
  }, []);
  return null;
};`,
  ],
  [
    "calls an imported addEventListener disposer from a cleanup",
    `import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(() => {});
    return () => unsubscribe();
  }, []);
  return null;
};`,
  ],
  [
    "calls every mapped addListener disposer with forEach",
    `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [tabs]);
  return null;
};`,
  ],
  [
    "calls every mapped addListener disposer with for-of",
    `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [tabs]);
  return null;
};`,
  ],
  [
    "removes every mapped React Native subscription",
    `import { useEffect } from "react";
import { AppState } from "react-native";
export const Component = ({ events }) => {
  useEffect(() => {
    const subscriptions = events.map((event) => AppState.addEventListener(event, () => {}));
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [events]);
  return null;
};`,
  ],
  [
    "owns a guarded timer helper invoked directly and by an owned listener",
    `import { useEffect } from "react";
import { AppState } from "react-native";
export const Component = () => {
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
      timer = setTimeout(() => {}, 30000);
    };
    const handleChange = (state) => state === "active" ? arm() : disarm();
    const subscription = AppState.addEventListener("change", handleChange);
    arm();
    return () => {
      disarm();
      subscription.remove();
    };
  }, []);
  return null;
};`,
  ],
  [
    "cleans an effect-local object member timer through dispose",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const resource = {
      timer: null,
      arm() {
        resource.timer = setTimeout(() => {}, 30000);
      },
      dispose() {
        clearTimeout(resource.timer);
      },
    };
    resource.arm();
    return () => resource.dispose();
  }, []);
  return null;
};`,
  ],
];

const invalidCases: ReadonlyArray<readonly [string, string]> = [
  [
    "does not treat a DOM addEventListener return value as callable cleanup",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const cleanup = window.addEventListener("resize", () => {});
    return cleanup;
  }, []);
  return null;
};`,
  ],
  [
    "does not treat a typed EventTarget return value as callable cleanup",
    `import { useEffect } from "react";
export const Component = ({ target }: { target: EventTarget }) => {
  useEffect(() => {
    const cleanup = target.addEventListener("change", () => {});
    return () => cleanup();
  }, [target]);
  return null;
};`,
  ],
  [
    "does not treat a React Native subscription object as callable cleanup",
    `import { useEffect } from "react";
import { AppState } from "react-native";
export const Component = () => {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", () => {});
    return subscription;
  }, []);
  return null;
};`,
  ],
  [
    "rejects a reassigned listener disposer handle",
    `import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let unsubscribe = NetInfo.addEventListener(() => {});
    unsubscribe = () => {};
    return unsubscribe;
  }, []);
  return null;
};`,
  ],
  [
    "does not call mapped DOM listener return values cleanup",
    `import { useEffect } from "react";
export const Component = ({ targets }: { targets: EventTarget[] }) => {
  useEffect(() => {
    const cleanups = targets.map((target) => target.addEventListener("change", () => {}));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [targets]);
  return null;
};`,
  ],
  [
    "rejects cleanup of a different disposer collection",
    `import { useEffect } from "react";
export const Component = ({ tabs, previousUnsubscribers }) => {
  useEffect(() => {
    tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => previousUnsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [tabs, previousUnsubscribers]);
  return null;
};`,
  ],
  [
    "rejects conditional cleanup within forEach",
    `import { useEffect } from "react";
export const Component = ({ tabs, enabled }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => unsubscribers.forEach((unsubscribe) => {
      if (enabled) unsubscribe();
    });
  }, [tabs, enabled]);
  return null;
};`,
  ],
  [
    "rejects non-exhaustive collection iteration",
    `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => unsubscribers.some((unsubscribe) => unsubscribe());
  }, [tabs]);
  return null;
};`,
  ],
  [
    "rejects a disposer collection that drops entries",
    `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    unsubscribers.pop();
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [tabs]);
  return null;
};`,
  ],
  [
    "rejects a timer helper that can overwrite a live handle",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      timer = setTimeout(() => {}, 30000);
    };
    arm();
    arm();
    return () => clearTimeout(timer);
  }, []);
  return null;
};`,
  ],
  [
    "rejects a timer helper invoked by a listener that is not removed",
    `import { useEffect } from "react";
import { AppState } from "react-native";
export const Component = () => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(() => {}, 30000);
    };
    AppState.addEventListener("change", arm);
    return () => clearTimeout(timer);
  }, []);
  return null;
};`,
  ],
  [
    "rejects a timer helper whose reference escapes",
    `import { useEffect } from "react";
export const Component = ({ register }) => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(() => {}, 30000);
    };
    register(arm);
    arm();
    return () => clearTimeout(timer);
  }, [register]);
  return null;
};`,
  ],
  [
    "keeps reporting a timer owned by a sibling effect",
    `import { useEffect, useLayoutEffect, useRef } from "react";
export const Component = ({ videoId }) => {
  const timerRef = useRef(null);
  useLayoutEffect(() => {
    timerRef.current = setTimeout(() => {}, 4000);
  }, [videoId]);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return null;
};`,
  ],
];

describe("effect-needs-cleanup issue #1558", () => {
  it.each(validCases)("accepts %s", (_name, source) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(invalidCases)("reports when cleanup %s", (_name, source) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
