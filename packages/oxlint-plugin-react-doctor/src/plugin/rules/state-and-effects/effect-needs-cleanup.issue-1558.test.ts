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
  [
    "cleans a listener timer retained in a React ref",
    `import { useEffect, useRef } from "react";
export const Component = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const handleResize = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {}, 30000);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  return null;
};`,
  ],
  [
    "cleans a listener timer through an exact local helper",
    `import { useEffect, useRef } from "react";
export const Component = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    const handleResize = () => {
      clearTimer();
      timerRef.current = setTimeout(() => {}, 30000);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimer();
    };
  }, []);
  return null;
};`,
  ],
  [
    "cleans every timer retained by an owned listener",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const timers = [];
    const handleResize = () => {
      timers.push(setTimeout(() => {}, 100));
      timers.push(setTimeout(() => {}, 200));
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      timers.forEach(clearTimeout);
    };
  }, []);
  return null;
};`,
  ],
  [
    "cleans every listener timer retained from a loop",
    `import { useEffect } from "react";
export const Component = ({ delays }) => {
  useEffect(() => {
    const timers = [];
    const handleResize = () => {
      for (const delay of delays) {
        timers.push(setTimeout(() => {}, delay));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      timers.forEach(clearTimeout);
    };
  }, [delays]);
  return null;
};`,
  ],
  [
    "cleans the latest handle in a recursive one-shot timer",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      timer = setTimeout(schedule, 30000);
    };
    schedule();
    return () => clearTimeout(timer);
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
    "rejects a disposer collection mutated through an effect-local helper",
    `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    const dropLast = () => unsubscribers.pop();
    dropLast();
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
  [
    "does not treat an imported DOM wrapper as a callable disposer",
    `import { document as importedDocument } from "global-jsdom";
import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const dispose = importedDocument.addEventListener("change", () => {});
    return () => dispose();
  }, []);
  return null;
};`,
  ],
  [
    "does not treat a Node EventEmitter instance as a callable disposer",
    `import { EventEmitter } from "node:events";
import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const emitter = new EventEmitter();
    const dispose = emitter.addListener("change", () => {});
    return () => dispose();
  }, []);
  return null;
};`,
  ],
  [
    "clears a different listener timer ref",
    `import { useEffect, useRef } from "react";
export const Component = () => {
  const timerRef = useRef(null);
  const previousTimerRef = useRef(null);
  useEffect(() => {
    const handleResize = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {}, 30000);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(previousTimerRef.current);
    };
  }, []);
  return null;
};`,
  ],
  [
    "drops a listener timer before collection cleanup",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    const timers = [];
    const handleResize = () => {
      timers.push(setTimeout(() => {}, 30000));
      timers.pop();
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      timers.forEach(clearTimeout);
    };
  }, []);
  return null;
};`,
  ],
  [
    "leaves the listener that owns a retained timer active",
    `import { useEffect, useRef } from "react";
export const Component = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const handleResize = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {}, 30000);
    };
    window.addEventListener("resize", handleResize);
    return () => clearTimeout(timerRef.current);
  }, []);
  return null;
};`,
  ],
  [
    "allows a listener timer ref to overwrite a live handle",
    `import { useEffect, useRef } from "react";
export const Component = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const handleResize = () => {
      timerRef.current = setTimeout(() => {}, 30000);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timerRef.current);
    };
  }, []);
  return null;
};`,
  ],
  [
    "conditionally calls a listener timer cleanup helper",
    `import { useEffect, useRef } from "react";
export const Component = ({ shouldRelease }) => {
  const timerRef = useRef(null);
  useEffect(() => {
    const clearTimer = () => {
      if (shouldRelease) clearTimeout(timerRef.current);
    };
    const handleResize = () => {
      clearTimer();
      timerRef.current = setTimeout(() => {}, 30000);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimer();
    };
  }, [shouldRelease]);
  return null;
};`,
  ],
  [
    "starts more than one recursive timer chain",
    `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      timer = setTimeout(schedule, 30000);
      timer = setTimeout(schedule, 30000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return null;
};`,
  ],
];

const timerAllocationVariants: ReadonlyArray<readonly [string, string, boolean]> = [
  [
    "early-return guard",
    `if (timer != null) return;
      timer = setTimeout(() => {}, 30000);`,
    true,
  ],
  [
    "release-before-replace guard",
    `if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {}, 30000);`,
    true,
  ],
  [
    "unconditional release before replace",
    `clearTimeout(timer);
      timer = setTimeout(() => {}, 30000);`,
    true,
  ],
  [
    "conditional release before replace",
    `if (condition) clearTimeout(timer);
      timer = setTimeout(() => {}, 30000);`,
    false,
  ],
  ["unprotected replacement", `timer = setTimeout(() => {}, 30000);`, false],
];

const timerInvocationVariants: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ["direct calls", `arm(); arm();`, `clearTimeout(timer);`, true],
  [
    "owned listener calls",
    `const unsubscribe = NetInfo.addEventListener(arm);`,
    `clearTimeout(timer); unsubscribe();`,
    true,
  ],
  ["deferred promise call", `Promise.resolve().then(arm);`, `clearTimeout(timer);`, false],
];

const generatedTimerCases = timerAllocationVariants.flatMap(
  ([allocationName, allocationBody, doesProtectLiveHandle]) =>
    timerInvocationVariants.map(
      ([invocationName, invocationBody, cleanupBody, doesEffectOwnInvocation]): readonly [
        string,
        string,
        boolean,
      ] => [
        `${allocationName} with ${invocationName}`,
        `import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
export const Component = ({ condition }) => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      ${allocationBody}
    };
    ${invocationBody}
    return () => { ${cleanupBody} };
  }, []);
  return null;
};`,
        doesProtectLiveHandle && doesEffectOwnInvocation,
      ],
    ),
);

const collectionStorageVariants: ReadonlyArray<readonly [string, string, boolean]> = [
  [
    "direct collection",
    `const ownedUnsubscribers = sources.map((source) => source.addListener("change", () => {}));`,
    true,
  ],
  [
    "stable alias",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers;`,
    true,
  ],
  [
    "full slice copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();`,
    true,
  ],
  [
    "full spread copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = [...unsubscribers];`,
    true,
  ],
  [
    "Array.from copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = Array.from(unsubscribers);`,
    true,
  ],
  [
    "empty concat copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.concat();`,
    true,
  ],
  [
    "reversed copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.toReversed();`,
    true,
  ],
  [
    "sorted copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.toSorted();`,
    true,
  ],
  [
    "source mutation after snapshot",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    unsubscribers.length = 0;`,
    true,
  ],
  [
    "source mutation through helper after snapshot",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    const clearSource = () => { unsubscribers.length = 0; };
    clearSource();`,
    true,
  ],
  [
    "source mutation through iterator after snapshot",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    unsubscribers.forEach(() => unsubscribers.pop());`,
    true,
  ],
  [
    "source escape after snapshot",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    register(unsubscribers);`,
    true,
  ],
  [
    "partial slice copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice(1);`,
    false,
  ],
  [
    "source mutation before snapshot",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    unsubscribers.length = 0;
    const ownedUnsubscribers = unsubscribers.slice();`,
    false,
  ],
  [
    "snapshot mutation after copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    ownedUnsubscribers.length = 0;`,
    false,
  ],
  [
    "snapshot mutation through helper after copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    const clearSnapshot = () => { ownedUnsubscribers.length = 0; };
    clearSnapshot();`,
    false,
  ],
  [
    "snapshot mutation through iterator after copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    ownedUnsubscribers.forEach(() => ownedUnsubscribers.pop());`,
    false,
  ],
  [
    "uninvoked snapshot mutation helper",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    const clearSnapshot = () => { ownedUnsubscribers.length = 0; };
    void clearSnapshot;`,
    true,
  ],
  [
    "source escape before snapshot",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    register(unsubscribers);
    const ownedUnsubscribers = unsubscribers.slice();`,
    false,
  ],
  [
    "filtered copy",
    `const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.filter(Boolean);`,
    false,
  ],
  [
    "escaped collection",
    `const ownedUnsubscribers = sources.map((source) => source.addListener("change", () => {}));
    register(ownedUnsubscribers);`,
    false,
  ],
];

const collectionCleanupVariants: ReadonlyArray<readonly [string, string, boolean]> = [
  ["forEach", `ownedUnsubscribers.forEach((unsubscribe) => unsubscribe());`, true],
  [
    "for-of with continue after release",
    `for (const unsubscribe of ownedUnsubscribers) {
        unsubscribe();
        if (condition) continue;
      }`,
    true,
  ],
  [
    "for-of with continue before release",
    `for (const unsubscribe of ownedUnsubscribers) {
        if (condition) continue;
        unsubscribe();
      }`,
    false,
  ],
  [
    "for-of with break after release",
    `for (const unsubscribe of ownedUnsubscribers) {
        unsubscribe();
        if (condition) break;
      }`,
    false,
  ],
  [
    "for-of with nested break before release",
    `for (const unsubscribe of ownedUnsubscribers) {
        for (const item of []) {
          if (item) break;
        }
        unsubscribe();
      }`,
    true,
  ],
  [
    "for-of with nested continue before release",
    `for (const unsubscribe of ownedUnsubscribers) {
        for (const item of []) {
          if (item) continue;
        }
        unsubscribe();
      }`,
    true,
  ],
  [
    "for-of with caught throw before release",
    `for (const unsubscribe of ownedUnsubscribers) {
        try {
          if (condition) throw new Error("retry");
        } catch {}
        unsubscribe();
      }`,
    true,
  ],
];

const generatedCollectionCases = collectionStorageVariants.flatMap(
  ([storageName, storageBody, doesStorageRetainEveryEntry]) =>
    collectionCleanupVariants.map(
      ([cleanupName, cleanupBody, doesCleanupVisitEveryEntry]): readonly [
        string,
        string,
        boolean,
      ] => [
        `${storageName} with ${cleanupName}`,
        `import { useEffect } from "react";
export const Component = ({ sources, condition, register }) => {
  useEffect(() => {
    ${storageBody}
    return () => {
      ${cleanupBody}
    };
  }, [sources, condition, register]);
  return null;
};`,
        doesStorageRetainEveryEntry && doesCleanupVisitEveryEntry,
      ],
    ),
);

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

  it.each(generatedTimerCases)(
    "proves generated timer ownership for %s",
    (_name, source, isSafe) => {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length > 0).toBe(!isSafe);
    },
  );

  it.each(generatedCollectionCases)(
    "proves generated collection ownership for %s",
    (_name, source, isSafe) => {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length > 0).toBe(!isSafe);
    },
  );
});
