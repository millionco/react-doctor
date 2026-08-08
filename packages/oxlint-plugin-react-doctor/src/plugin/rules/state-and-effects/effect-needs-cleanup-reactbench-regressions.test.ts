import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup React Bench regressions", () => {
  it("accepts a stable passive options alias with default capture", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const options = { passive: false };
    node.addEventListener("wheel", handler, options);
    return () => node.removeEventListener("wheel", handler);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a stable options alias with mismatched capture", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const options = { capture: true, passive: false };
    node.addEventListener("wheel", handler, options);
    return () => node.removeEventListener("wheel", handler);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts immutable equivalent event listener options aliases", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const addOptions = { capture: true };
    const removeOptions = { capture: true };
    node.addEventListener("wheel", handler, addOptions);
    return () => node.removeEventListener("wheel", handler, removeOptions);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a mutated removal options alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const addOptions = { capture: true };
    const removeOptions = { capture: true };
    node.addEventListener("wheel", handler, addOptions);
    removeOptions.capture = false;
    return () => node.removeEventListener("wheel", handler, removeOptions);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a mutated registration options alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const addOptions = { capture: true };
    const removeOptions = { capture: false };
    node.addEventListener("wheel", handler, addOptions);
    addOptions.capture = false;
    return () => node.removeEventListener("wheel", handler, removeOptions);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a mutated event listener options alias chain", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const addBase = { capture: true };
    const removeBase = { capture: true };
    const addAlias = addBase;
    const removeAlias = removeBase;
    node.addEventListener("wheel", handler, addAlias);
    removeBase.capture = false;
    return () => node.removeEventListener("wheel", handler, removeAlias);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps immutable event listener options alias chains unproven", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTarget = ({ node }) => {
  useEffect(() => {
    const handler = () => undefined;
    const addBase = { capture: true };
    const removeBase = { capture: true };
    const addAlias = addBase;
    const removeAlias = removeBase;
    node.addEventListener("wheel", handler, addAlias);
    return () => node.removeEventListener("wheel", handler, removeAlias);
  }, [node]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts cleanup across exhaustive local target loops", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTargets = ({ first, second }) => {
  useEffect(() => {
    const targets = [first, second];
    const handler = () => undefined;
    for (const target of targets) {
      target.addEventListener("wheel", handler, { passive: false });
    }
    return () => {
      for (const target of targets) {
        target.removeEventListener("wheel", handler);
      }
    };
  }, [first, second]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps cleanup that drops a local target before release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WheelTargets = ({ first, second }) => {
  useEffect(() => {
    const targets = [first, second];
    const handler = () => undefined;
    for (const target of targets) {
      target.addEventListener("wheel", handler);
    }
    targets.shift();
    return () => {
      for (const target of targets) {
        target.removeEventListener("wheel", handler);
      }
    };
  }, [first, second]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts exact unary listener cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LegacySubscription = ({ source }) => {
  useEffect(() => {
    const handler = () => undefined;
    source.addListener(handler);
    return () => source.removeListener(handler);
  }, [source]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps unary listener cleanup with a different handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LegacySubscription = ({ source }) => {
  useEffect(() => {
    const handler = () => undefined;
    const otherHandler = () => undefined;
    source.addListener(handler);
    return () => source.removeListener(otherHandler);
  }, [source]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a typed timer handle released on unmount", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedTask = () => {
  useEffect(() => {
    const timer = setTimeout(task, 10) as unknown as number;
    return () => clearTimeout(timer);
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a typed timer handle when cleanup releases another handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedTask = () => {
  useEffect(() => {
    const timer = setTimeout(task, 10) as unknown as number;
    const otherTimer = 1;
    return () => clearTimeout(otherTimer);
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts same-node-aware JSX callback-ref replacement", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const WheelTarget = ({ onWheel }) => {
  const nodeRef = useRef(null);
  const setNode = useCallback((node) => {
    const previous = nodeRef.current;
    if (previous && previous !== node) {
      previous.removeEventListener("wheel", onWheel);
    }
    nodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={setNode} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps same-node-aware callback-ref cleanup with a different target", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const WheelTarget = ({ onWheel }) => {
  const nodeRef = useRef(null);
  const setNode = useCallback((node) => {
    const previous = nodeRef.current;
    if (previous && previous !== node) {
      window.removeEventListener("wheel", onWheel);
    }
    nodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={setNode} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an unowned one-shot timer in an effect-invoked callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect } from "react";
export const DelayedSubscription = ({ delay, subscribe }) => {
  const start = useCallback(() => {
    setTimeout(subscribe, delay);
  }, [delay, subscribe]);
  useEffect(() => {
    start();
  }, [start]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps an event-only guarded timer exempt when the effect call omits the event", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedAction = () => {
  const handle = (event?: Event) => {
    if (!event) return;
    setTimeout(() => undefined, 100);
  };
  useEffect(() => {
    handle();
  }, []);
  return <button onClick={handle}>Start</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a statically unreachable timer exempt in an effect-invoked callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedAction = () => {
  const start = () => {
    if (false) setTimeout(() => undefined, 100);
  };
  useEffect(() => {
    start();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a timer exempt when the effect invocation is statically unreachable", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedAction = () => {
  const start = () => setTimeout(() => undefined, 100);
  useEffect(() => {
    if (false) start();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a timer when an early return can skip the effect invocation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedAction = ({ enabled }) => {
  const start = () => setTimeout(() => undefined, 100);
  useEffect(() => {
    if (!enabled) return;
    start();
  }, [enabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a timer behind a dynamic condition in an effect-invoked callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DelayedAction = ({ enabled }) => {
  const start = () => {
    if (enabled) setTimeout(() => undefined, 100);
  };
  useEffect(() => {
    start();
  }, [enabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an effect-invoked callback whose timer is released", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const DelayedSubscription = ({ delay, subscribe }) => {
  const timerRef = useRef(null);
  const start = useCallback(() => {
    timerRef.current = setTimeout(subscribe, delay);
  }, [delay, subscribe]);
  useEffect(() => {
    start();
    return () => clearTimeout(timerRef.current);
  }, [start]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps an event-only callback one-shot timer exempt", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const DelayedAction = ({ delay, action }) => {
  const start = useCallback(() => {
    setTimeout(action, delay);
  }, [action, delay]);
  return <button onClick={start}>Start</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps statically unreachable retained resources quiet", () => {
    const timerResult = runRule(
      effectNeedsCleanup,
      `const TimerRef = ({ task }) => {
  const callbackRef = () => {
    if (false) setInterval(task, 10);
  };
  return <div ref={callbackRef} />;
};`,
    );
    const subscriptionResult = runRule(
      effectNeedsCleanup,
      `const SubscriptionRef = ({ source }) => {
  const callbackRef = () => {
    if (false) source.subscribe(() => undefined);
  };
  return <div ref={callbackRef} />;
};`,
    );
    const listenerResult = runRule(
      effectNeedsCleanup,
      `const ListenerRef = ({ node, handler }) => {
  const callbackRef = () => {
    if (false) node.addEventListener("focus", handler);
  };
  return <div ref={callbackRef} />;
};`,
    );
    expect(timerResult.diagnostics).toHaveLength(0);
    expect(subscriptionResult.diagnostics).toHaveLength(0);
    expect(listenerResult.diagnostics).toHaveLength(0);
  });

  it("reports dynamically conditional retained resources", () => {
    const result = runRule(
      effectNeedsCleanup,
      `const TimerRef = ({ enabled, task }) => {
  const callbackRef = () => {
    if (enabled) setInterval(task, 10);
  };
  return <div ref={callbackRef} />;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports direct effect-owned timers in parameterized callbacks", () => {
    const requiredResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (delay) => setTimeout(task, delay);
  useEffect(() => {
    start(10);
  }, []);
  return null;
};`,
    );
    const defaultResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (delay = 10) => setTimeout(task, delay);
  useEffect(() => {
    start();
  }, []);
  return null;
};`,
    );
    const restResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (...delays) => setTimeout(task, delays[0]);
  useEffect(() => {
    start(10);
  }, []);
  return null;
};`,
    );
    expect(requiredResult.diagnostics).toHaveLength(1);
    expect(defaultResult.diagnostics).toHaveLength(1);
    expect(restResult.diagnostics).toHaveLength(1);
  });

  it("uses direct invocation arguments to resolve conditional effect-owned timers", () => {
    const trueResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (enabled) => {
    if (enabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start(true);
  }, []);
  return null;
};`,
    );
    const dynamicResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ enabled, task }) => {
  const start = (shouldStart) => {
    if (shouldStart) setTimeout(task, 10);
  };
  useEffect(() => {
    start(enabled);
  }, [enabled]);
  return null;
};`,
    );
    const defaultTrueResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (enabled = true) => {
    if (enabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start();
  }, []);
  return null;
};`,
    );
    const falseResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (enabled) => {
    if (enabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start(false);
  }, []);
  return null;
};`,
    );
    const omittedOptionalResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (event) => {
    if (event) setTimeout(task, 10);
  };
  useEffect(() => {
    start();
  }, []);
  return null;
};`,
    );
    expect(trueResult.diagnostics).toHaveLength(1);
    expect(dynamicResult.diagnostics).toHaveLength(1);
    expect(defaultTrueResult.diagnostics).toHaveLength(1);
    expect(falseResult.diagnostics).toHaveLength(0);
    expect(omittedOptionalResult.diagnostics).toHaveLength(0);
  });

  it("reports when any effect invocation can reach a conditional timer", () => {
    const mixedInvocationResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (enabled) => {
    if (enabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start(false);
    start(true);
  }, []);
  return null;
};`,
    );
    const reassignedParameterResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (enabled) => {
    enabled = true;
    if (enabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start(false);
  }, []);
  return null;
};`,
    );
    const invertedFalseResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (disabled) => {
    if (!disabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start(false);
  }, []);
  return null;
};`,
    );
    const invertedTrueResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (disabled) => {
    if (!disabled) setTimeout(task, 10);
  };
  useEffect(() => {
    start(true);
  }, []);
  return null;
};`,
    );
    expect(mixedInvocationResult.diagnostics).toHaveLength(1);
    expect(reassignedParameterResult.diagnostics).toHaveLength(1);
    expect(invertedFalseResult.diagnostics).toHaveLength(1);
    expect(invertedTrueResult.diagnostics).toHaveLength(0);
  });

  it("reports effect-owned timers invoked by synchronous array iterators", () => {
    const forEachResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ items, task }) => {
  const start = (item) => setTimeout(() => task(item), 10);
  useEffect(() => {
    items.forEach(start);
  }, [items]);
  return null;
};`,
    );
    const mapResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ items, task }) => {
  const start = (item) => setTimeout(() => task(item), 10);
  useEffect(() => {
    items.map(start);
  }, [items]);
  return null;
};`,
    );
    expect(forEachResult.diagnostics).toHaveLength(1);
    expect(mapResult.diagnostics).toHaveLength(1);
  });

  it("keeps deferred callback handoffs exempt", () => {
    const promiseResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ promise, task }) => {
  const start = (value) => setTimeout(() => task(value), 10);
  useEffect(() => {
    promise.then(start);
  }, [promise]);
  return null;
};`,
    );
    const listenerResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ target, task }) => {
  const start = (event) => setTimeout(() => task(event), 10);
  useEffect(() => {
    target.addEventListener("click", start);
    return () => target.removeEventListener("click", start);
  }, [target]);
  return null;
};`,
    );
    expect(promiseResult.diagnostics).toHaveLength(0);
    expect(listenerResult.diagnostics).toHaveLength(0);
  });

  it("does not attribute a different helper invocation to the timer owner", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Delayed = ({ task }) => {
  const start = (event) => {
    if (!event) return;
    setTimeout(() => task(event), 10);
  };
  const initialize = () => undefined;
  useEffect(() => {
    initialize();
  }, []);
  return <button onClick={start}>Start</button>;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a ref-owned timer released through a parameterized helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const timerRef = useRef(null);
  const clearTimerRef = (ownedTimerRef) => {
    if (ownedTimerRef.current) {
      clearTimeout(ownedTimerRef.current);
      ownedTimerRef.current = null;
    }
  };
  useEffect(() => {
    return () => clearTimerRef(timerRef);
  }, []);
  useEffect(() => {
    clearTimerRef(timerRef);
    timerRef.current = setTimeout(task, delay);
  }, [delay, task]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts ref-owned timers released through useCallback helpers", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const timerRef = useRef(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);
  useEffect(() => {
    clearTimer();
    if (delay <= 0) return;
    timerRef.current = setTimeout(task, delay);
  }, [clearTimer, delay, task]);
  return null;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts timer handles retained in stable ref fields", () => {
    const directStorageResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const timerRef = useRef(null);
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);
  useEffect(() => {
    clearTimeout(timerRef.current);
    const timer = setTimeout(task, delay);
    timerRef.current = timer;
  }, [delay, task]);
  return null;
};`,
    );
    const objectStorageResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const pendingRef = useRef(null);
  useEffect(() => {
    return () => clearTimeout(pendingRef.current.timeout);
  }, []);
  useEffect(() => {
    clearTimeout(pendingRef.current.timeout);
    pendingRef.current = {
      timeout: setTimeout(task, delay),
      startedAt: Date.now(),
    };
  }, [delay, task]);
  return null;
};`,
    );
    expect(directStorageResult.diagnostics).toHaveLength(0);
    expect(objectStorageResult.diagnostics).toHaveLength(0);
  });

  it("accepts retained resources released through their exact local aliases", () => {
    const socketResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Connection = ({ url }) => {
  const socketRef = useRef(null);
  useEffect(() => {
    const socket = new WebSocket(url);
    socketRef.current = socket;
    return () => socket.close();
  }, [url]);
  return null;
};`,
    );
    const timerResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Poller = ({ pollInterval, refresh }) => {
  const intervalRef = useRef(null);
  useEffect(() => {
    const intervalId = setInterval(refresh, pollInterval);
    intervalRef.current = intervalId;
    return () => clearInterval(intervalId);
  }, [pollInterval, refresh]);
  return null;
};`,
    );
    const subscriptionResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Subscriber = ({ source }) => {
  const subscriptionRef = useRef(null);
  useEffect(() => {
    const subscription = source.subscribe(() => {});
    subscriptionRef.current = subscription;
    return () => subscription.unsubscribe();
  }, [source]);
  return null;
};`,
    );
    expect(socketResult.diagnostics).toHaveLength(0);
    expect(timerResult.diagnostics).toHaveLength(0);
    expect(subscriptionResult.diagnostics).toHaveLength(0);
  });

  it("does not confuse a retained resource with a different local cleanup alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Connections = ({ primaryUrl, secondaryUrl }) => {
  const primarySocketRef = useRef(null);
  useEffect(() => {
    const primarySocket = new WebSocket(primaryUrl);
    const secondarySocket = new WebSocket(secondaryUrl);
    primarySocketRef.current = primarySocket;
    return () => secondarySocket.close();
  }, [primaryUrl, secondaryUrl]);
  return null;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("WebSocket");
  });

  it("accepts EventSource listeners released by closing their exact local owner", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const JobEvents = ({ jobId }) => {
  const eventSourceRef = useRef(null);
  useEffect(() => {
    const source = new EventSource(\`/api/jobs/\${jobId}/events\`);
    eventSourceRef.current = source;
    source.addEventListener("progress", () => {});
    source.addEventListener("complete", () => {});
    source.addEventListener("error", () => {});
    return () => source.close();
  }, [jobId]);
  return null;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat close as owned listener cleanup for an opaque EventTarget", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Listener = ({ createTarget }) => {
  useEffect(() => {
    const target = createTarget();
    target.addEventListener("change", () => {});
    return () => target.close();
  }, [createTarget]);
  return null;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  it("keeps conditional and mismatched timer retention conservative", () => {
    const conditionalStorageResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, enabled, task }) => {
  const timerRef = useRef(null);
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);
  useEffect(() => {
    clearTimeout(timerRef.current);
    const timer = setTimeout(task, delay);
    if (enabled) timerRef.current = timer;
  }, [delay, enabled, task]);
  return null;
};`,
    );
    const mismatchedStorageResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const pendingRef = useRef(null);
  useEffect(() => {
    return () => clearTimeout(pendingRef.current.otherTimeout);
  }, []);
  useEffect(() => {
    clearTimeout(pendingRef.current.timeout);
    const timer = setTimeout(task, delay);
    pendingRef.current = { timeout: timer };
  }, [delay, task]);
  return null;
};`,
    );
    expect(conditionalStorageResult.diagnostics).toHaveLength(1);
    expect(mismatchedStorageResult.diagnostics).toHaveLength(1);
  });

  it("requires every cleanup-effect path to release the retained timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, enabled, task }) => {
  const timerRef = useRef(null);
  useEffect(() => {
    if (enabled) return () => clearTimeout(timerRef.current);
  }, [enabled]);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(task, delay);
  }, [delay, task]);
  return null;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps parameterized helpers tied to the exact timer owner", () => {
    const replacementMismatchResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const timerRef = useRef(null);
  const otherTimerRef = useRef(null);
  const clearTimerRef = (ownedTimerRef) => clearTimeout(ownedTimerRef.current);
  useEffect(() => {
    return () => clearTimerRef(timerRef);
  }, []);
  useEffect(() => {
    clearTimerRef(otherTimerRef);
    timerRef.current = setTimeout(task, delay);
  }, [delay, task]);
  return null;
};`,
    );
    const unmountMismatchResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const timerRef = useRef(null);
  const otherTimerRef = useRef(null);
  const clearTimerRef = (ownedTimerRef) => clearTimeout(ownedTimerRef.current);
  useEffect(() => {
    return () => clearTimerRef(otherTimerRef);
  }, []);
  useEffect(() => {
    clearTimerRef(timerRef);
    timerRef.current = setTimeout(task, delay);
  }, [delay, task]);
  return null;
};`,
    );
    expect(replacementMismatchResult.diagnostics).toHaveLength(1);
    expect(unmountMismatchResult.diagnostics).toHaveLength(1);
  });

  it("keeps reassigned cleanup-helper parameters conservative", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
const Delayed = ({ delay, task }) => {
  const timerRef = useRef(null);
  const otherTimerRef = useRef(null);
  const clearTimerRef = (ownedTimerRef) => {
    ownedTimerRef = otherTimerRef;
    clearTimeout(ownedTimerRef.current);
  };
  useEffect(() => {
    return () => clearTimerRef(timerRef);
  }, []);
  useEffect(() => {
    clearTimerRef(timerRef);
    timerRef.current = setTimeout(task, delay);
  }, [delay, task]);
  return null;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts listener teardown collected in a cleanup registry", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ targets, type, handler }) => {
        useEffect(() => {
          const cleanups = [];
          targets.forEach((target) => {
            target.addEventListener(type, handler);
            cleanups.push(() => target.removeEventListener(type, handler));
          });
          return () => cleanups.forEach((cleanup) => cleanup());
        }, [targets, type, handler]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a cleanup registry that can drop registered teardowns", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ target, type, handler }) => {
        useEffect(() => {
          const cleanups = [];
          target.addEventListener(type, handler);
          cleanups.push(() => target.removeEventListener(type, handler));
          cleanups.pop();
          return () => cleanups.forEach((cleanup) => cleanup());
        }, [target, type, handler]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a cleanup registry whose teardown capture is conditional", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ enabled, target, type, handler }) => {
        useEffect(() => {
          const cleanups = [];
          target.addEventListener(type, handler);
          if (enabled) cleanups.push(() => target.removeEventListener(type, handler));
          return () => cleanups.forEach((cleanup) => cleanup());
        }, [enabled, target, type, handler]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts listener teardown delegated through a local stop helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ handleMouseMove }) => {
        const stopDragging = () => window.removeEventListener("mousemove", handleMouseMove);
        useEffect(() => {
          window.addEventListener("mousemove", handleMouseMove);
          return () => stopDragging();
        }, [handleMouseMove]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts symmetric nested listener iteration", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ enabledEvents, elementRefs, isCaptureEvent }) => {
        useEffect(() => {
          enabledEvents.forEach(({ event, listener }) =>
            elementRefs.forEach((ref) => ref.addEventListener(event, listener, isCaptureEvent(event)))
          );
          return () => enabledEvents.forEach(({ event, listener }) =>
            elementRefs.forEach((ref) => ref.removeEventListener(event, listener, isCaptureEvent(event)))
          );
        }, [enabledEvents, elementRefs]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an inert one-shot callback-ref timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
      const C = () => {
        const suppressClickRef = useRef(false);
        const attach = useCallback((node) => {
          if (!node) return;
          suppressClickRef.current = true;
          setTimeout(() => { suppressClickRef.current = false; }, 100);
        }, []);
        return <div ref={attach} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a one-shot timer guarded by cleanup-backed mounted state", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ setIsOpen }) => {
        const mounted = useRef(true);
        useEffect(() => () => { mounted.current = false; }, []);
        useEffect(() => {
          setTimeout(() => {
            if (!mounted.current) return;
            setIsOpen(true);
          }, 10);
        }, [setIsOpen]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a mounted guard whose cleanup invalidation is conditional", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ enabled, setIsOpen }) => {
        const mounted = useRef(true);
        useEffect(() => () => {
          if (enabled) mounted.current = false;
        }, [enabled]);
        useEffect(() => {
          setTimeout(() => {
            if (!mounted.current) return;
            setIsOpen(true);
          }, 10);
        }, [setIsOpen]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a mounted guard to dominate one-shot timer work", () => {
    const resultAfterWork = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ setIsOpen }) => {
        const mounted = useRef(true);
        useEffect(() => () => { mounted.current = false; }, []);
        useEffect(() => {
          setTimeout(() => {
            setIsOpen(true);
            if (!mounted.current) return;
          }, 10);
        }, [setIsOpen]);
        return null;
      };`,
    );
    const resultNestedGuard = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ setIsOpen }) => {
        const mounted = useRef(true);
        useEffect(() => () => { mounted.current = false; }, []);
        useEffect(() => {
          setTimeout(() => {
            const checkMounted = () => { if (!mounted.current) return; };
            checkMounted;
            setIsOpen(true);
          }, 10);
        }, [setIsOpen]);
        return null;
      };`,
    );
    expect(resultAfterWork.parseErrors).toEqual([]);
    expect(resultAfterWork.diagnostics).toHaveLength(1);
    expect(resultNestedGuard.parseErrors).toEqual([]);
    expect(resultNestedGuard.diagnostics).toHaveLength(1);
  });

  it("accepts delayed destruction after resources are synchronously detached", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
      const C = () => {
        const documentsRef = useRef(new Map());
        const clearDocuments = useCallback(() => {
          const documents = Array.from(documentsRef.current.values());
          documentsRef.current.clear();
          if (documents.length === 0) return;
          setTimeout(() => documents.forEach((document) => document.destroy()), 0);
        }, []);
        return <button onClick={clearDocuments}>Clear</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts short one-shot timers that only reset refs inside effects", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ target }) => {
        const suppressClickRef = useRef(false);
        const movedRef = useRef(false);
        useEffect(() => {
          const handleMouseUp = () => {
            setTimeout(() => {
              suppressClickRef.current = false;
              movedRef.current = false;
            }, 300);
          };
          target.addEventListener("mouseup", handleMouseUp);
          return () => target.removeEventListener("mouseup", handleMouseUp);
        }, [target]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports one-shot effect timers with observable or delayed work", () => {
    const stateUpdateResult = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ setOpen, target }) => {
        useEffect(() => {
          const handleMouseUp = () => setTimeout(() => setOpen(false), 100);
          target.addEventListener("mouseup", handleMouseUp);
          return () => target.removeEventListener("mouseup", handleMouseUp);
        }, [target]);
        return null;
      };`,
    );
    const delayedResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ target }) => {
        const activeRef = useRef(true);
        useEffect(() => {
          const handleMouseUp = () => setTimeout(() => {
            activeRef.current = false;
          }, 301);
          target.addEventListener("mouseup", handleMouseUp);
          return () => target.removeEventListener("mouseup", handleMouseUp);
        }, [target]);
        return null;
      };`,
    );
    expect(stateUpdateResult.diagnostics).toHaveLength(1);
    expect(delayedResult.diagnostics).toHaveLength(1);
  });

  it("accepts an object-held timer released through a cleanup helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ delay, open }) => {
        const pendingShowRef = useRef(null);
        const cancelPendingShow = () => {
          if (pendingShowRef.current) clearTimeout(pendingShowRef.current.timer);
          pendingShowRef.current = null;
        };
        useEffect(() => {
          pendingShowRef.current = { timer: setTimeout(open, delay) };
          return () => cancelPendingShow();
        }, [delay, open]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a retained callback timer transferred into an object-held ref", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ delay, open }) => {
        const pendingShowRef = useRef(null);
        const cancelPendingShow = () => {
          if (pendingShowRef.current?.timer) clearTimeout(pendingShowRef.current.timer);
          pendingShowRef.current = null;
        };
        const scheduleShow = () => {
          cancelPendingShow();
          const timer = setTimeout(open, delay);
          pendingShowRef.current = { timer, startedAt: Date.now() };
        };
        useEffect(() => {
          scheduleShow();
          return () => cancelPendingShow();
        }, []);
        return <button onClick={scheduleShow}>Show</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a parameterized retained timer with early exits and mount cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ defaultOpen, open }) => {
        const pendingOpenRef = useRef(null);
        const clearPendingOpen = () => {
          if (pendingOpenRef.current?.id) clearTimeout(pendingOpenRef.current.id);
          pendingOpenRef.current = null;
        };
        const startShowDelay = (delay, options, isImperative) => {
          clearPendingOpen();
          if (delay <= 0) {
            open();
            return;
          }
          const startTime = Date.now();
          const id = setTimeout(() => {
            pendingOpenRef.current = null;
            open();
          }, delay);
          pendingOpenRef.current = { id, startTime, options, isImperative };
        };
        useEffect(() => {
          if (defaultOpen) startShowDelay(10, null, false);
          return () => {
            clearPendingOpen();
          };
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports retained object-held timers without complete ownership", () => {
    const missingUnmountResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ delay, open }) => {
        const pendingShowRef = useRef(null);
        const scheduleShow = () => {
          if (pendingShowRef.current?.timer) clearTimeout(pendingShowRef.current.timer);
          const timer = setTimeout(open, delay);
          pendingShowRef.current = { timer };
        };
        useEffect(() => {
          scheduleShow();
        }, [delay]);
        return null;
      };`,
    );
    const overwriteResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ delay, open, target }) => {
        const pendingShowRef = useRef(null);
        const scheduleShow = () => {
          const timer = setTimeout(open, delay);
          pendingShowRef.current = { timer };
        };
        useEffect(() => {
          scheduleShow();
          target.addEventListener("click", scheduleShow);
          return () => {
            target.removeEventListener("click", scheduleShow);
            clearTimeout(pendingShowRef.current?.timer);
          };
        }, [target]);
        return null;
      };`,
    );
    expect(missingUnmountResult.diagnostics).toHaveLength(1);
    expect(overwriteResult.diagnostics).toHaveLength(1);
  });

  it("accepts a ref-owned replacement timer with separate unmount cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ delay, open }) => {
        const pendingShowRef = useRef(null);
        const cancelPendingShow = () => {
          if (pendingShowRef.current?.timer) clearTimeout(pendingShowRef.current.timer);
          pendingShowRef.current = null;
        };
        useEffect(() => () => cancelPendingShow(), []);
        useEffect(() => {
          const pending = pendingShowRef.current;
          if (!pending) return;
          clearTimeout(pending.timer);
          const timer = setTimeout(open, delay);
          pending.timer = timer;
        }, [delay, open]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a mounted guard invalidated by an imported isomorphic effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useRef } from "react";
      import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";
      const C = ({ open }) => {
        const mounted = useRef(false);
        useIsomorphicLayoutEffect(() => {
          mounted.current = true;
          return () => {
            mounted.current = false;
          };
        }, []);
        const scheduleShow = () => {
          setTimeout(() => {
            if (!mounted.current) return;
            open();
          }, 10);
        };
        useIsomorphicLayoutEffect(() => {
          scheduleShow();
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a subscription token released through a cleanup helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
      const C = ({ timer, tick }) => {
        const run = useRef({ loopID: null });
        const cancelCurrentRun = () => {
          if (run.current.loopID) timer.unsubscribe(run.current.loopID);
          run.current.loopID = null;
        };
        useEffect(() => {
          run.current.loopID = timer.subscribe(tick);
          return () => cancelCurrentRun();
        }, [timer, tick]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a disposer stored on an object before the object moves into a ref", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
      const C = () => {
        const dragRef = useRef(null);
        const beginDrag = useCallback(() => {
          const drag = { cleanup: () => undefined };
          const handleMove = () => undefined;
          window.addEventListener("mousemove", handleMove);
          drag.cleanup = () => window.removeEventListener("mousemove", handleMove);
          dragRef.current = drag;
        }, []);
        const cancelDrag = useCallback(() => {
          const drag = dragRef.current;
          if (drag) {
            drag.cleanup();
            dragRef.current = null;
          }
        }, []);
        useEffect(() => cancelDrag, [cancelDrag]);
        return <button onMouseDown={beginDrag} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts callback-ref listener metadata retained as one ref session", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
      const C = () => {
        const listenerRef = useRef(null);
        const setNode = useCallback((element) => {
          if (listenerRef.current) {
            listenerRef.current.element.removeEventListener("wheel", listenerRef.current.handler);
            listenerRef.current = null;
          }
          if (!element) return;
          const handler = () => undefined;
          element.addEventListener("wheel", handler, { passive: false });
          listenerRef.current = { element, handler };
        }, []);
        return <button ref={setNode} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts symmetric listener loops over a stable filtered array", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ node }) => {
        useEffect(() => {
          const nodes = [node, node.closest(".owner")].filter(Boolean);
          const handler = () => undefined;
          for (const target of nodes) target.addEventListener("wheel", handler);
          return () => {
            for (const target of nodes) target.removeEventListener("wheel", handler);
          };
        }, [node]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a finite event-name loop stored in a ref-owned disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
      const C = () => {
        const detachRef = useRef(() => undefined);
        const detach = useCallback(() => detachRef.current(), []);
        const attach = useCallback((kind) => {
          detach();
          const events = kind === "pointer" ? ["pointerup", "pointercancel"] : ["mouseup"];
          const handler = () => undefined;
          for (const eventName of events) window.addEventListener(eventName, handler);
          detachRef.current = () => {
            for (const eventName of events) window.removeEventListener(eventName, handler);
          };
        }, [detach]);
        useEffect(() => detach, [detach]);
        return <button onMouseDown={() => attach("mouse")} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts nested listener loops over stable tuple and target collections", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ primary, secondary }) => {
        useEffect(() => {
          const once = (handler) => (event) => handler(event);
          const listeners = [["wheel", once(() => undefined), { passive: false }], ["mouseup", once(() => undefined)]];
          const targets = [primary];
          if (secondary) targets.push(secondary);
          for (const target of targets) {
            for (const [eventName, handler, options] of listeners) {
              target.addEventListener(eventName, handler, options);
            }
          }
          return () => {
            for (const target of targets) {
              for (const [eventName, handler] of listeners) {
                target.removeEventListener(eventName, handler);
              }
            }
          };
        }, [primary, secondary]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts listeners released through an exhaustively replayed cleanup registry", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ target }) => {
        useEffect(() => {
          const cleanups = [];
          const listen = (eventName, handler, options) => {
            target.addEventListener(eventName, handler, options);
            cleanups.push(() => target.removeEventListener(eventName, handler, options));
          };
          listen("wheel", () => undefined, { passive: false });
          return () => {
            for (const cleanup of cleanups) cleanup();
          };
        }, [target]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a timer on a discriminated object transferred into a cleanup-owned ref", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
      const C = ({ open }) => {
        const pendingRef = useRef(null);
        const cancel = () => {
          if (pendingRef.current?.timer) clearInterval(pendingRef.current.timer);
          pendingRef.current = null;
        };
        const schedule = useCallback(() => {
          const pending = pendingRef.current;
          if (pending?.source === "button") return;
          if (pending?.source === "api") return;
          const next = { source: "button", timer: null };
          pendingRef.current = next;
          next.timer = setInterval(open, 1000);
        }, [open]);
        useEffect(() => () => cancel(), []);
        return <button onClick={schedule} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a callback-ref session with mismatched stored listener metadata", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
      const C = () => {
        const listenerRef = useRef(null);
        const setNode = useCallback((element) => {
          if (listenerRef.current) {
            listenerRef.current.element.removeEventListener("wheel", listenerRef.current.handler);
          }
          if (!element) return;
          const handler = () => undefined;
          element.addEventListener("wheel", handler);
          listenerRef.current = { element, handler: () => undefined };
        }, []);
        return <button ref={setNode} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a symmetric listener loop whose collection mutates before cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ first, second }) => {
        useEffect(() => {
          const nodes = [first, second].filter(Boolean);
          const handler = () => undefined;
          for (const node of nodes) node.addEventListener("wheel", handler);
          nodes.pop();
          return () => {
            for (const node of nodes) node.removeEventListener("wheel", handler);
          };
        }, [first, second]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a tuple listener loop when one registration uses capture", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ target }) => {
        useEffect(() => {
          const listeners = [["wheel", () => undefined, { capture: true }]];
          for (const [eventName, handler, options] of listeners) {
            target.addEventListener(eventName, handler, options);
          }
          return () => {
            for (const [eventName, handler] of listeners) {
              target.removeEventListener(eventName, handler);
            }
          };
        }, [target]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a cleanup registry replay that exits before every disposer runs", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const C = ({ target }) => {
        useEffect(() => {
          const cleanups = [];
          const listen = (eventName, handler) => {
            target.addEventListener(eventName, handler);
            cleanups.push(() => target.removeEventListener(eventName, handler));
          };
          listen("wheel", () => undefined);
          return () => {
            for (const cleanup of cleanups) {
              if (Math.random() > 0.5) break;
              cleanup();
            }
          };
        }, [target]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a ref timer when its discriminant guard misses a stored variant", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
      const C = ({ open, source }) => {
        const pendingRef = useRef(null);
        const cancel = () => {
          if (pendingRef.current?.timer) clearInterval(pendingRef.current.timer);
          pendingRef.current = null;
        };
        const schedule = useCallback(() => {
          const pending = pendingRef.current;
          if (pending?.source === "button") return;
          if (pending?.source === "api") return;
          const next = { source, timer: null };
          pendingRef.current = next;
          next.timer = setInterval(open, 1000);
        }, [open, source]);
        useEffect(() => () => cancel(), []);
        return <button onClick={schedule} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a timer cleanup returned to a caller that discards it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
      const C = ({ open }) => {
        const schedule = useCallback(() => {
          const timer = setInterval(open, 1000);
          return () => clearInterval(timer);
        }, [open]);
        return <button onClick={schedule} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
