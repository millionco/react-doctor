import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

const closureHeldCleanup = `
import { useEffect, useRef } from "react";

export const ClosureHeldCleanup = ({ selector }: { selector: string }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanupObserver = () => {};

    const observeHero = () => {
      const hero = document.querySelector<HTMLElement>(selector);
      if (!hero) return () => {};
      const observer = new IntersectionObserver(() => {});
      observer.observe(hero);
      return () => observer.disconnect();
    };

    cleanupObserver = observeHero();
    return () => cleanupObserver();
  }, [selector]);

  return <div ref={ref} />;
};
`;

const callbackRefObserver = `
import { useCallback, useRef, useState } from "react";

export const CallbackRefObserver = () => {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const setRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width)
    );
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  return <div ref={setRef}>{width}</div>;
};
`;

const observeInForEach = `
import { useEffect, useRef } from "react";

export const ObserveInForEach = () => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = root.querySelectorAll<HTMLElement>("[data-card]");
    const observer = new IntersectionObserver(() => {});
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return <div ref={rootRef} />;
};
`;

const teardownViaHelper = `
import { useEffect } from "react";

export const TeardownViaHelper = () => {
  useEffect(() => {
    let animationFrameId: number | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    const stopAutoScroll = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    const onEvent = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        animationFrameId = requestAnimationFrame(() => {});
      }, 1500);
    };

    const events = ["scroll", "pointerdown", "keydown"] as const;
    for (const eventName of events) {
      window.addEventListener(eventName, onEvent, { passive: true });
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, onEvent);
      }
      stopAutoScroll();
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, []);

  return null;
};
`;

const unsafeClosureHeldCleanup = `
import { useEffect } from "react";

export const UnsafeClosureHeldCleanup = ({ selector }: { selector: string }) => {
  useEffect(() => {
    let frame = 0;
    let cleanupObserver = () => {};
    const observeHero = () => {
      const hero = document.querySelector<HTMLElement>(selector);
      if (!hero) return () => {};
      const observer = new IntersectionObserver(() => {});
      observer.observe(hero);
      return () => observer.disconnect();
    };
    const scheduleReobserve = () => {
      frame = window.requestAnimationFrame(() => {
        cleanupObserver();
        cleanupObserver = observeHero();
      });
    };
    cleanupObserver = observeHero();
    window.addEventListener("resize", scheduleReobserve);
    return () => {
      window.cancelAnimationFrame(frame);
      cleanupObserver();
      window.removeEventListener("resize", scheduleReobserve);
    };
  }, [selector]);
  return null;
};
`;

const unsafeTeardownViaHelper = teardownViaHelper.replace(
  "    const onEvent = () => {\n      if (resumeTimer) clearTimeout(resumeTimer);",
  "    const onEvent = () => {",
);

const callbackRefWithoutUnmountRelease = callbackRefObserver.replace(
  "    observerRef.current?.disconnect();",
  "    if (element) observerRef.current?.disconnect();",
);

const callbackRefWithoutOwnershipStorage = callbackRefObserver.replace(
  "    observerRef.current = observer;",
  "",
);

const forEachWithoutUniversalDisconnect = observeInForEach.replace(
  "    return () => observer.disconnect();",
  "    return () => observer.unobserve(cards[0]);",
);

const storedDisposerWithoutCleanup = closureHeldCleanup.replace(
  "    return () => cleanupObserver();",
  "    return () => {};",
);

const storedDisposerWithCleanupBeforeAssignment = `
import { useEffect } from "react";

export const StoredDisposerWithEarlyCleanup = ({ element, skip }) => {
  useEffect(() => {
    let cleanupObserver = () => {};
    const observe = () => {
      const observer = new IntersectionObserver(() => {});
      observer.observe(element);
      return () => observer.disconnect();
    };
    if (skip) return () => cleanupObserver();
    cleanupObserver = observe();
    return () => {};
  }, [element, skip]);
  return null;
};
`;

const partialUnsubscribe = `
import { useEffect } from "react";

export const PartialUnsubscribe = ({ api }) => {
  useEffect(() => {
    const onSelect = () => {};
    api.on("reInit", onSelect);
    api.on("select", onSelect);
    return () => {
      api?.off("select", onSelect);
    };
  }, [api]);
  return null;
};
`;

describe("issue 1736", () => {
  it.each([
    ["closure-held cleanup", closureHeldCleanup],
    ["callback ref observer", callbackRefObserver],
    ["observe in forEach", observeInForEach],
    ["teardown through helper", teardownViaHelper],
  ])("accepts %s", (_name, code) => {
    expect(runRule(effectNeedsCleanup, code).diagnostics).toEqual([]);
  });

  it("accepts a closure-held observer cleanup", () => {
    expect(runRule(effectObserverNeedsDisconnect, closureHeldCleanup).diagnostics).toEqual([]);
  });

  it("reports a partial unsubscribe", () => {
    expect(runRule(effectNeedsCleanup, partialUnsubscribe).diagnostics).toHaveLength(1);
  });

  it.each([
    ["overwritten animation frames", unsafeClosureHeldCleanup],
    ["overwritten timeouts", unsafeTeardownViaHelper],
    ["a callback ref without unmount release", callbackRefWithoutUnmountRelease],
    ["a callback ref without ownership storage", callbackRefWithoutOwnershipStorage],
    ["a partial forEach observer release", forEachWithoutUniversalDisconnect],
    ["a stored disposer without cleanup", storedDisposerWithoutCleanup],
    ["a stored disposer with only an earlier cleanup", storedDisposerWithCleanupBeforeAssignment],
  ])("reports %s", (_name, code) => {
    expect(runRule(effectNeedsCleanup, code).diagnostics).toHaveLength(1);
  });

  it.each([
    ["a deferred stored disposer", unsafeClosureHeldCleanup],
    ["a stored disposer without cleanup", storedDisposerWithoutCleanup],
    ["a stored disposer with only an earlier cleanup", storedDisposerWithCleanupBeforeAssignment],
  ])("reports %s for the observer rule", (_name, code) => {
    expect(runRule(effectObserverNeedsDisconnect, code).diagnostics).toHaveLength(1);
  });
});
