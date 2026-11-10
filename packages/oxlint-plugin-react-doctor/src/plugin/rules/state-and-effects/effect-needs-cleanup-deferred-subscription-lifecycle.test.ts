import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const subscriptionDeclaration = `
  interface Subscription { remove: () => void; }
  declare const Accelerometer: {
    isAvailableAsync: () => Promise<boolean>;
    addListener: (callback: () => void) => Subscription;
  };
`;

const guardedAcquisition = `
  void Accelerometer.isAvailableAsync().then((available) => {
    if (!available || cancelled) return;
    subscription = Accelerometer.addListener(() => {});
  });
`;

describe("deferred subscription lifecycle", () => {
  it.each([
    ["optional release", "cancelled = true; subscription?.remove();", 0],
    ["live handle branch", "cancelled = true; if (subscription) subscription.remove();", 0],
    ["early null exit", "cancelled = true; if (!subscription) return; subscription.remove();", 0],
    [
      "early null exit and reset after release",
      "cancelled = true; if (!subscription) return; subscription.remove(); subscription = null;",
      0,
    ],
    [
      "conditional exit after null exit",
      "cancelled = true; if (!subscription) return; if (skip) return; subscription.remove();",
      1,
    ],
    [
      "throw after null exit",
      'cancelled = true; if (!subscription) return; throw new Error("stop"); subscription.remove();',
      1,
    ],
    [
      "reset before optional release",
      "cancelled = true; if (!subscription) return; subscription = null; subscription?.remove();",
      1,
    ],
    ["unrelated conditional release", "cancelled = true; if (skip) subscription?.remove();", 1],
    ["missing cancellation", "subscription?.remove();", 1],
    ["wrong cancellation value", "cancelled = false; subscription?.remove();", 1],
    ["wrong release receiver", "cancelled = true; Accelerometer.remove();", 1],
    [
      "overwritten handle",
      "cancelled = true; subscription = otherSubscription; subscription?.remove();",
      1,
    ],
    [
      "reacquisition after release",
      "cancelled = true; subscription?.remove(); subscription = Accelerometer.addListener(() => {});",
      1,
    ],
  ])("checks %s", (_name, cleanup, expectedCount) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      ${subscriptionDeclaration}
      const Panel = ({ skip, otherSubscription }) => {
        useEffect(() => {
          let cancelled = false;
          let subscription: Subscription | null = null;
          ${guardedAcquisition}
          return () => { ${cleanup} };
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each([
    ["direct promise", guardedAcquisition, 0],
    [
      "named callback without self-reference",
      `void Accelerometer.isAvailableAsync().then(function onAvailable(available) {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
      });`,
      0,
    ],
    [
      "named callback recursion",
      `let again = true;
      void Accelerometer.isAvailableAsync().then(function onAvailable(available) {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
        if (again) { again = false; onAvailable(available); }
      });`,
      1,
    ],
    [
      "named callback escape",
      `void Accelerometer.isAvailableAsync().then(function onAvailable(available) {
        if (!available || cancelled) return;
        capturedCallback = onAvailable;
        subscription = Accelerometer.addListener(() => {});
      });`,
      1,
    ],
    ["outer loop", `for (const value of [1, 2]) { ${guardedAcquisition} }`, 1],
    [
      "repeated local helper",
      `const subscribe = () => { ${guardedAcquisition} }; subscribe(); subscribe();`,
      1,
    ],
    [
      "local non-Promise thenable",
      `const getThenable = () => ({ then(callback) { callback(true); callback(true); } });
      void getThenable().then((available) => {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
      });`,
      1,
    ],
    [
      "local native promise producer",
      `const getAvailability = () => Promise.resolve(true);
      void getAvailability().then((available) => {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
      });`,
      0,
    ],
    [
      "local async promise producer",
      `const getAvailability = async () => true;
      void getAvailability().then((available) => {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
      });`,
      0,
    ],
    [
      "overwritten native continuation",
      `const availability = Promise.resolve(true);
      availability.then = (callback) => { callback(true); callback(true); };
      const getAvailability = () => availability;
      void getAvailability().then((available) => {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
      });`,
      1,
    ],
    [
      "escaped native promise",
      `const availability = Promise.resolve(true);
      alter(availability);
      const getAvailability = () => availability;
      void getAvailability().then((available) => {
        if (!available || cancelled) return;
        subscription = Accelerometer.addListener(() => {});
      });`,
      1,
    ],
  ])("checks %s acquisition", (_name, acquisition, expectedCount) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      ${subscriptionDeclaration}
      const Panel = () => {
        useEffect(() => {
          let cancelled = false;
          let subscription: Subscription | null = null;
          ${acquisition}
          return () => { cancelled = true; subscription?.remove(); };
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each([
    ["opaque producer", "declare const getAvailability: () => unknown;", "getAvailability()", 1],
    ["opaque method", "declare const Accelerometer: any;", "Accelerometer.isAvailableAsync()", 1],
    [
      "PromiseLike contract",
      subscriptionDeclaration.replace("Promise<boolean>", "PromiseLike<boolean>"),
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "shadowed Promise contract",
      `interface Promise<Value> { then(callback: (value: Value) => void): void; }
      ${subscriptionDeclaration}`,
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "generic Promise shadow",
      subscriptionDeclaration.replace("() => Promise<boolean>", "<Promise>() => Promise<boolean>"),
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "modified native then",
      `${subscriptionDeclaration} Promise.prototype.then = customThen;`,
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "modified global Promise",
      `${subscriptionDeclaration} globalThis.Promise = CustomPromise;`,
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "modified declared producer",
      `${subscriptionDeclaration} Accelerometer.isAvailableAsync = getThenable;`,
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "declared Promise method",
      subscriptionDeclaration.replace("isAvailableAsync: () =>", "isAvailableAsync():"),
      "Accelerometer.isAvailableAsync()",
      0,
    ],
    [
      "overloaded non-Promise method",
      `declare const Accelerometer: {
        isAvailableAsync(mode: "promise"): Promise<boolean>;
        isAvailableAsync(): { then(callback: (value: boolean) => void): void };
        addListener: (callback: () => void) => { remove: () => void };
      };`,
      "Accelerometer.isAvailableAsync()",
      1,
    ],
    [
      "imported Expo API",
      'import { Accelerometer } from "expo-sensors";',
      "Accelerometer.isAvailableAsync()",
      0,
    ],
    [
      "other imported API",
      'import { Accelerometer } from "custom-sensors";',
      "Accelerometer.isAvailableAsync()",
      1,
    ],
  ])("requires positive promise evidence for %s", (_name, declaration, producer, expectedCount) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      ${declaration}
      const Panel = () => {
        useEffect(() => {
          let cancelled = false;
          let subscription = null;
          void ${producer}.then((available) => {
            if (!available || cancelled) return;
            subscription = Accelerometer.addListener(() => {});
          });
          return () => { cancelled = true; subscription?.remove(); };
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each(["catch", "finally"])("rejects a mutated then below %s", (methodName) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      ${subscriptionDeclaration}
      const Panel = () => {
        useEffect(() => {
          let cancelled = false;
          let subscription = null;
          const availability = Promise.resolve(true);
          availability.then = () => ({ then(callback) { callback(true); callback(true); } });
          const getAvailability = () => availability.${methodName}(() => true);
          void getAvailability().then((available) => {
            if (!available || cancelled) return;
            subscription = Accelerometer.addListener(() => {});
          });
          return () => { cancelled = true; subscription?.remove(); };
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
});
