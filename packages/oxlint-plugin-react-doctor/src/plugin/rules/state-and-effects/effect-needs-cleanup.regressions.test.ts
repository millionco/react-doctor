import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup regressions (PR #988 CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES)", () => {
  it("flags an implicit return of a react-hook-form `.watch()` handle (non-callable { unsubscribe })", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WatchForm = ({ form }) => {
  useEffect(() => form.watch((value) => {
    console.log(value);
  }), [form]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("watch");
  });

  it("flags returning a captured `.watch()` subscription object as cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const WatchForm = ({ form }) => {
  useEffect(() => {
    const subscription = form.watch((value) => {
      console.log(value);
    });
    return subscription;
  }, [form]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags directly returning an `fs.watch()` FSWatcher (cleanup is .close(), not the handle)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
import fs from "node:fs";
export const FileWatcher = ({ path }) => {
  useEffect(() => {
    return fs.watch(path, (eventType) => {
      console.log(eventType);
    });
  }, [path]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a `server.listen()` call with no cleanup return", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DevServer = ({ server }) => {
  useEffect(() => {
    server.listen(3000);
  }, [server]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("listen");
  });

  it("does not flag a `.listen()` subscription whose returned disposer is returned as cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const StoreListener = ({ store }) => {
  useEffect(() => {
    const stop = store.listen((value) => {
      console.log(value);
    });
    return stop;
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `.subscribe()` subscription whose returned disposer is returned as cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const StoreSubscriber = ({ store }) => {
  useEffect(() => {
    const unsubscribe = store.subscribe((value) => {
      console.log(value);
    });
    return unsubscribe;
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `.subscribe()` disposer invoked by the returned cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const StoreSubscriber = ({ store }) => {
  useEffect(() => {
    const unsubscribe = store.subscribe(update);
    return () => unsubscribe();
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cleanup function returned through a const alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LiveFeed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    const closeSocket = () => socket.close();
    const cleanup = closeSocket;
    return cleanup;
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Mined miss (gatsby loading-indicator): the cleanup calls `.off` with a
  // FRESH inline arrow — a different reference from the one `.on` registered
  // — so reference-based removal removes nothing and the listeners leak.
  it("flags a cleanup whose `.off` handler is a new inline arrow (gatsby shape)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useState } from "react";
import emitter from "./emitter";
export const LoadingIndicatorEventHandler = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    emitter.on("onDelayedLoadPageResources", () => setVisible(true));
    emitter.on("onRouteUpdate", () => setVisible(false));
    return () => {
      emitter.off("onDelayedLoadPageResources", () => setVisible(true));
      emitter.off("onRouteUpdate", () => setVisible(false));
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a cleanup that removes the same named handler reference", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = ({ target }) => {
  useEffect(() => {
    const onScroll = () => update();
    target.addEventListener("scroll", onScroll);
    return () => target.removeEventListener("scroll", onScroll);
  }, [target]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a listener released through an aliased destructured abort signal", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = () => {
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const listenerSignal = signal;
    window.addEventListener("resize", update, { signal: listenerSignal });
    return () => controller.abort();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an abort signal passed through a variable options bag", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = () => {
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    window.addEventListener("resize", update, options);
    return () => controller.abort();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `.off(name)` remove-all cleanup with no handler argument", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
import emitter from "./emitter";
export const Listener = () => {
  useEffect(() => {
    emitter.on("update", () => refresh());
    return () => emitter.off("update");
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a ResizeObserver observed in an effect without disconnect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Measurer = () => {
  const elementRef = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    observer.observe(elementRef.current);
  }, []);
  return <div ref={elementRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("observe");
  });

  it("does not flag an observer whose cleanup calls disconnect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Measurer = () => {
  const elementRef = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(() => update());
    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={elementRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts observers retained and disconnected through the same collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element }) => {
  useLayoutEffect(() => {
    const observers = [];
    for (let node = element; node; node = node.parentElement) {
      const observer = new MutationObserver(update);
      observer.observe(node, { attributes: true });
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [element]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts multiple observers pushed into the same cleanup collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element, parentElement }) => {
  useLayoutEffect(() => {
    const observers = [];
    const elementObserver = new MutationObserver(update);
    elementObserver.observe(element, { attributes: true });
    observers.push(elementObserver);
    const parentObserver = new MutationObserver(update);
    parentObserver.observe(parentElement, { attributes: true });
    observers.push(parentObserver);
    return () => observers.forEach((observer) => observer.disconnect());
  }, [element, parentElement]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects conditionally retaining an observed resource for collection cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element, shouldRetain }) => {
  useLayoutEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(element, { attributes: true });
    if (shouldRetain) observers.push(observer);
    return () => observers.forEach((retainedObserver) => retainedObserver.disconnect());
  }, [element, shouldRetain]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects disconnecting a different observer collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element, previousObservers }) => {
  useLayoutEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(element, { attributes: true });
    observers.push(observer);
    return () => previousObservers.forEach((retainedObserver) => retainedObserver.disconnect());
  }, [element, previousObservers]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects conditionally iterating the observer collection during cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element, shouldCleanup }) => {
  useLayoutEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(element, { attributes: true });
    observers.push(observer);
    return () => {
      if (shouldCleanup) {
        observers.forEach((retainedObserver) => retainedObserver.disconnect());
      }
    };
  }, [element, shouldCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects short-circuit iteration of the observer collection during cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element }) => {
  useLayoutEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(element, { attributes: true });
    observers.push(observer);
    return () => observers.some((retainedObserver) => {
      retainedObserver.disconnect();
      return true;
    });
  }, [element]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts observer collection cleanup through a direct for-of loop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ObserverGroup = ({ nodes }) => {
  useEffect(() => {
    const observers = [];
    for (const node of nodes) {
      const observer = new ResizeObserver(updateSize);
      observer.observe(node);
      observers.push(observer);
    }
    return () => {
      for (const observer of observers) {
        observer.disconnect();
      }
    };
  }, [nodes]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts matching unobserve cleanup through an observer collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ObserverGroup = ({ target }) => {
  useEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true });
    observers.push(observer);
    return () => observers.forEach((retainedObserver) => retainedObserver.unobserve(target));
  }, [target]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects unobserving a different target through an observer collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ObserverGroup = ({ target, otherTarget }) => {
  useEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true });
    observers.push(observer);
    return () =>
      observers.forEach((retainedObserver) => retainedObserver.unobserve(otherTarget));
  }, [target, otherTarget]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects mutating an observer collection after retaining the resource", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useLayoutEffect } from "react";
export const ContextWatcher = ({ element }) => {
  useLayoutEffect(() => {
    const observers = [];
    const observer = new MutationObserver(update);
    observer.observe(element, { attributes: true });
    observers.push(observer);
    observers.pop();
    return () => observers.forEach((retainedObserver) => retainedObserver.disconnect());
  }, [element]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a MutationObserver cleaned up via unobserve", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DomWatcher = ({ target }) => {
  useEffect(() => {
    const observer = new MutationObserver(() => update());
    observer.observe(target, { childList: true });
    return () => observer.unobserve(target);
  }, [target]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a WebSocket opened in an effect without close", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LiveFeed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onmessage = (event) => update(event.data);
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("WebSocket");
    expect(result.diagnostics[0].message).toContain("connection");
  });

  it("flags returning the WebSocket handle itself as cleanup (closes nothing)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LiveFeed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    return socket;
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a BroadcastChannel opened in an effect without close", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const TabSync = ({ channelName }) => {
  useEffect(() => {
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (event) => applyRemoteChange(event.data);
  }, [channelName]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("BroadcastChannel");
  });

  it("does not flag an RTCPeerConnection closed in cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Call = ({ config }) => {
  useEffect(() => {
    const peerConnection = new RTCPeerConnection(config);
    peerConnection.ontrack = (event) => attachStream(event.streams[0]);
    return () => peerConnection.close();
  }, [config]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an EventSource closed in cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ServerEvents = ({ url }) => {
  useEffect(() => {
    const source = new EventSource(url);
    source.onmessage = (event) => update(event.data);
    return () => source.close();
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a discarded setInterval inside a useCallback (unclearable)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Poller = () => {
  const startPolling = useCallback(() => {
    setInterval(() => poll(), 1000);
  }, []);
  return <button onClick={startPolling}>start</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("does not flag a setInterval in useCallback whose id is captured", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Poller = () => {
  const intervalRef = useRef(null);
  const startPolling = useCallback(() => {
    intervalRef.current = setInterval(() => poll(), 1000);
  }, []);
  const stopPolling = useCallback(() => {
    clearInterval(intervalRef.current);
  }, []);
  return <button onClick={startPolling} onBlur={stopPolling}>start</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-shot setTimeout in a component-scope handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useState } from "react";
export const Toast = () => {
  const [visible, setVisible] = useState(false);
  const showToast = () => {
    setVisible(true);
    setTimeout(() => setVisible(false), 3000);
  };
  return <button onClick={showToast}>show</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a discarded setInterval inside a component-scope handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Ticker = () => {
  const startTicking = () => {
    setInterval(() => tick(), 1000);
  };
  return <button onClick={startTicking}>tick</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an addEventListener in a handler when the file has no release call at all", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const KeyTracker = () => {
  const armListener = () => {
    window.addEventListener("keydown", (event) => track(event.key));
  };
  return <button onClick={armListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  it("does not flag a handler subscription when another function releases it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const KeyTracker = () => {
  const onKeyDown = (event) => track(event.key);
  const armListener = () => {
    window.addEventListener("keydown", onKeyDown);
  };
  const disarmListener = () => {
    window.removeEventListener("keydown", onKeyDown);
  };
  return <button onClick={armListener} onBlur={disarmListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `{ once: true }` listener registered in a handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const OneShot = () => {
  const armListener = () => {
    window.addEventListener("pointerup", () => finish(), { once: true });
  };
  return <button onPointerDown={armListener}>press</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a handler that manages its own release (toggle shape)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Toggle = ({ emitter, handler }) => {
  const retarget = () => {
    emitter.off("change", handler);
    emitter.on("change", handler);
  };
  return <button onClick={retarget}>retarget</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a captured subscription disposer in a useCallback when it is never released", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const StoreBridge = ({ store }) => {
  const unsubscribeRef = useRef(null);
  const connect = useCallback(() => {
    unsubscribeRef.current = store.subscribe(() => sync());
  }, [store]);
  return <button onClick={connect}>connect</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a `{ once: false }` listener registered in a handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const KeyTracker = () => {
  const armListener = () => {
    window.addEventListener("keydown", (event) => track(event.key), { once: false });
  };
  return <button onClick={armListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  it("flags a listener whose `once` option is a variable (may be false)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const KeyTracker = ({ shouldFireOnce }) => {
  const armListener = () => {
    window.addEventListener("keydown", (event) => track(event.key), { once: shouldFireOnce });
  };
  return <button onClick={armListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a listener released through an abort `{ signal }` option", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const KeyTracker = ({ controller }) => {
  const armListener = () => {
    window.addEventListener("keydown", (event) => track(event.key), { signal: controller.signal });
  };
  return <button onClick={armListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a handler listener even when the same handler closes an unrelated resource", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Recorder = ({ stream }) => {
  const armListener = () => {
    stream.close();
    window.addEventListener("keydown", (event) => track(event.key));
  };
  return <button onClick={armListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  it("flags a discarded setInterval even when the same handler closes a connection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Reconnector = ({ socket }) => {
  const restart = () => {
    socket.close();
    setInterval(() => tick(), 1000);
  };
  return <button onClick={restart}>restart</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("flags a discarded setInterval when the handler clears an unrelated interval", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Ticker = ({ tickIdRef }) => {
  const restart = () => {
    clearInterval(tickIdRef.current);
    setInterval(() => tick(), 1000);
  };
  return <button onClick={restart}>restart</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a WebSocket constructed as a concise useCallback body", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const LiveFeed = ({ url }) => {
  const connect = useCallback(() => new WebSocket(url), [url]);
  return <button onClick={connect}>connect</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("WebSocket");
  });

  it("flags an EventSource constructed as a concise component-scope handler body", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const ServerEvents = ({ url }) => {
  const connect = () => new EventSource(url);
  return <button onClick={connect}>connect</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("EventSource");
  });

  it("flags a concise-body socket whose handle is stored in a ref but never closed", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const LiveFeed = ({ url }) => {
  const socketRef = useRef(null);
  const connect = useCallback(() => (socketRef.current = new WebSocket(url)), [url]);
  return <button onClick={connect}>connect</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not attribute a setInterval inside a nested inner callback to the retained handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Chart = ({ node }) => {
  const draw = useCallback(() => {
    render(node, {
      onFrame: () => {
        setInterval(() => tick(), 1000);
      },
    });
  }, [node]);
  return <button onClick={draw}>draw</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a direct leak in a handler that also defines a nested inner function", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Poller = () => {
  const startPolling = () => {
    const format = (value) => String(value);
    setInterval(() => poll(format), 1000);
  };
  return <button onClick={startPolling}>start</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("still flags an HTTP `server.listen(port)` whose returned server is returned from the effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DevServer = ({ app }) => {
  useEffect(() => {
    const server = app.listen(3000);
    return server;
  }, [app]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup retained disposer refs", () => {
  it.each([
    {
      name: "98wDqG6 direct unmount cleanup",
      source: `import { useCallback, useEffect, useRef } from "react";
export const useMouseDrag = () => {
  const dragCleanupRef = useRef(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const handleMouseDown = useCallback(() => {
    dragCleanupRef.current?.();
    const handleMove = () => undefined;
    const handleUp = () => dragCleanupRef.current?.();
    dragCleanupRef.current = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, []);
  return { handleMouseDown };
};`,
    },
    {
      name: "3eK8hRx branch-specific disposer",
      source: `import { useCallback, useEffect, useRef } from "react";
export const useDrag = () => {
  const detachRef = useRef(null);
  useEffect(() => () => detachRef.current?.(), []);
  const beginDrag = useCallback((pointer) => {
    const handleMove = () => undefined;
    const handleEnd = () => detachRef.current?.();
    if (pointer) {
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
      detachRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
      };
    } else {
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleEnd);
      detachRef.current = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleEnd);
      };
    }
  }, []);
  return { beginDrag };
};`,
    },
    {
      name: "qpcGDXC named disposer",
      source: `import { useCallback, useEffect, useRef } from "react";
export const useMouseDrag = () => {
  const cleanupRef = useRef(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const handleMouseDown = useCallback(() => {
    function handleMove() {}
    function cleanup() {
      window.removeEventListener("mousemove", handleMove);
      cleanupRef.current = null;
    }
    cleanupRef.current = cleanup;
    window.addEventListener("mousemove", handleMove);
  }, []);
  return { handleMouseDown };
};`,
    },
    {
      name: "EtLZbea callback-ref disposer with effect fallback",
      source: `import { useCallback, useEffect, useRef } from "react";
export const useWheelTarget = () => {
  const detachRef = useRef(null);
  const buttonRef = useCallback((node) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!node) return;
    const handleWheel = () => undefined;
    node.addEventListener("wheel", handleWheel);
    detachRef.current = () => node.removeEventListener("wheel", handleWheel);
  }, []);
  useEffect(() => () => detachRef.current?.(), []);
  return { buttonRef };
};`,
    },
    {
      name: "nnYUFLa returned callback ref cleanup",
      source: `import { useCallback, useRef } from "react";
export const useViewport = () => {
  const detachRef = useRef(null);
  const setViewportRef = useCallback((node) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!node) return;
    const onWheel = () => undefined;
    const onMove = () => undefined;
    node.addEventListener("wheel", onWheel);
    node.addEventListener("pointermove", onMove);
    detachRef.current = () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointermove", onMove);
    };
  }, []);
  return { setViewportRef };
};`,
    },
    {
      name: "fy5ENpL callback ref forwarded through a prop",
      source: `import { useCallback, useRef } from "react";
const Viewport = ({ buttonRef }) => <button ref={buttonRef} />;
const usePhotoZoom = () => {
  const detachRef = useRef(null);
  const setViewportNode = useCallback((node) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!node) return;
    const handleWheel = () => undefined;
    node.addEventListener("wheel", handleWheel);
    detachRef.current = () => node.removeEventListener("wheel", handleWheel);
  }, []);
  return { setViewportNode };
};
export const Gallery = () => {
  const zoom = usePhotoZoom();
  return <Viewport buttonRef={zoom.setViewportNode} />;
};`,
    },
    {
      name: "5ggdJBZ stable callback returned as cleanup",
      source: `import { useCallback, useEffect, useRef } from "react";
export const useWindowPan = () => {
  const detachRef = useRef(null);
  const detachWindowListeners = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);
  const attachWindowListeners = useCallback(() => {
    const handleMove = () => undefined;
    const handleEnd = () => detachWindowListeners();
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);
    detachRef.current = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
    };
  }, [detachWindowListeners]);
  useEffect(() => detachWindowListeners, [detachWindowListeners]);
  return { attachWindowListeners };
};`,
    },
  ])("accepts $name", ({ source }) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a callback ref returned from a non-hook function", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
const userPhotoZoom = () => {
  const detachRef = useRef(null);
  const setViewportNode = useCallback((node) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!node) return;
    const handleWheel = () => undefined;
    node.addEventListener("wheel", handleWheel);
    detachRef.current = () => node.removeEventListener("wheel", handleWheel);
  }, []);
  return { setViewportNode };
};
export const Gallery = () => {
  const zoom = userPhotoZoom();
  return <button ref={zoom.setViewportNode} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "cleanup effect calls a different ref",
      cleanup: `useEffect(() => () => otherRef.current?.(), []);`,
      registration: `cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
    window.addEventListener("mousemove", handleMove);`,
    },
    {
      name: "stored disposer removes a different handler",
      cleanup: `useEffect(() => () => cleanupRef.current?.(), []);`,
      registration: `cleanupRef.current = () => window.removeEventListener("mousemove", otherHandler);
    window.addEventListener("mousemove", handleMove);`,
    },
    {
      name: "disposer storage is conditional",
      cleanup: `useEffect(() => () => cleanupRef.current?.(), []);`,
      registration: `if (enabled) cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
    window.addEventListener("mousemove", handleMove);`,
    },
    {
      name: "cleanup ref is overwritten",
      cleanup: `useEffect(() => () => cleanupRef.current?.(), []);`,
      registration: `cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
    window.addEventListener("mousemove", handleMove);
    cleanupRef.current = null;`,
    },
    {
      name: "cleanup ref is conditionally overwritten",
      cleanup: `useEffect(() => () => cleanupRef.current?.(), []);`,
      registration: `cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
    window.addEventListener("mousemove", handleMove);
    if (enabled) cleanupRef.current = null;`,
    },
  ])("reports when $name", ({ cleanup, registration }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useMouseDrag = ({ enabled, otherHandler }) => {
  const cleanupRef = useRef(null);
  const otherRef = useRef(null);
  ${cleanup}
  const handleMouseDown = useCallback(() => {
    const handleMove = () => undefined;
    ${registration}
  }, [enabled, otherHandler]);
  return { handleMouseDown };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup self-releasing gesture listeners", () => {
  it("accepts the react-bnb mouseup-owned release protocol", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const useZoomPan = () => {
  const dragRef = useRef(null);
  const panBy = useCallback(() => {}, []);
  const onMouseDown = useCallback((event) => {
    dragRef.current = { startX: event.clientX, startY: event.clientY };
    function handleMouseMove(moveEvent) {
      panBy(moveEvent.clientX, moveEvent.clientY);
    }
    function handleMouseUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [panBy]);
  return { onMouseDown };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a const-bound end listener that releases itself and its peer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const useDrag = () => {
  const onMouseDown = useCallback(() => {
    const handleMouseMove = () => updatePosition();
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);
  return onMouseDown;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts the end listener registered before its peer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const useDrag = () => {
  const onMouseDown = useCallback(() => {
    function handleMouseMove() {
      updatePosition();
    }
    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleMouseMove);
  }, []);
  return onMouseDown;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "a conditionally registered end listener",
      moveOptions: "",
      releaseBody:
        'window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp);',
      endRegistration: 'if (shouldAttachEnd) window.addEventListener("mouseup", handleMouseUp);',
      endPrefix: "",
    },
    {
      name: "a conditionally executed release",
      moveOptions: "",
      releaseBody:
        'if (shouldRelease) { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); }',
      endRegistration: 'window.addEventListener("mouseup", handleMouseUp);',
      endPrefix: "",
    },
    {
      name: "an async end listener",
      moveOptions: "",
      releaseBody:
        'window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp);',
      endRegistration: 'window.addEventListener("mouseup", handleMouseUp);',
      endPrefix: "async ",
    },
    {
      name: "an end listener on a different receiver",
      moveOptions: "",
      releaseBody:
        'window.removeEventListener("mousemove", handleMouseMove); document.removeEventListener("mouseup", handleMouseUp);',
      endRegistration: 'document.addEventListener("mouseup", handleMouseUp);',
      endPrefix: "",
    },
    {
      name: "a capture mismatch",
      moveOptions: ", true",
      releaseBody:
        'window.removeEventListener("mousemove", handleMouseMove, false); window.removeEventListener("mouseup", handleMouseUp);',
      endRegistration: 'window.addEventListener("mouseup", handleMouseUp);',
      endPrefix: "",
    },
  ])("rejects $name", ({ moveOptions, releaseBody, endRegistration, endPrefix }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const useDrag = ({ shouldAttachEnd, shouldRelease }) => {
  const onMouseDown = useCallback(() => {
    function handleMouseMove() {
      updatePosition();
    }
    ${endPrefix}function handleMouseUp() {
      ${releaseBody}
    }
    window.addEventListener("mousemove", handleMouseMove${moveOptions});
    ${endRegistration}
  }, [shouldAttachEnd, shouldRelease]);
  return onMouseDown;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("effect-needs-cleanup — for-of listener pairs", () => {
  it("accepts matching listener setup and cleanup loops over the same event collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const;
export const OutsideAction = ({ isOpen, onOutsideAction, onKeyDown }) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onKeyDown, onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts transparent wrappers and a stable alias of the same event collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event as keyof DocumentEventMap, onOutsideAction);
    }
    const cleanupEvents = outsideActionEvents;
    return () => {
      for (const event of cleanupEvents) {
        document.removeEventListener((event), onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an unconditional loop in a synchronously invoked cleanup helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    const removeOutsideActionListeners = () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
    return () => removeOutsideActionListeners();
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts equivalent statically proven capture after an unknown spread", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction, unknownOptions }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction, { ...unknownOptions, capture: true });
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction, true);
      }
    };
  }, [onOutsideAction, unknownOptions]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts benign reads and calls on the document receiver", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    document.body;
    void document.body;
    document.createElement("div");
    document.querySelector("main");
    const root = document.querySelector("#root");
    root?.classList.add("ready");
    window.document.title;
    globalThis.document.body;
    window.document.createElement("span");
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "different iterable",
      cleanup:
        "for (const event of keyboardEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "different target",
      cleanup:
        "for (const event of outsideActionEvents) window.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "different handler",
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOtherAction);",
    },
    {
      name: "different event",
      cleanup:
        'for (const event of outsideActionEvents) document.removeEventListener("keydown", onOutsideAction);',
    },
    {
      name: "conditional cleanup",
      cleanup:
        "if (shouldCleanup) for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
  ])("rejects a $name loop cleanup", ({ cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const;
const keyboardEvents = ["keydown"] as const;
export const OutsideAction = ({ onOutsideAction, onOtherAction, shouldCleanup }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      ${cleanup}
    };
  }, [onOtherAction, onOutsideAction, shouldCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a destructured cleanup loop until element identity can be proven", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const listenerEntries = [["mousedown", onMouseDown], ["focusin", onFocusIn]] as const;
export const OutsideAction = () => {
  useEffect(() => {
    for (const [event, handler] of listenerEntries) {
      document.addEventListener(event, handler);
    }
    return () => {
      for (const [event, handler] of listenerEntries) {
        document.removeEventListener(event, handler);
      }
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).not.toHaveLength(0);
  });

  it.each([
    {
      name: "different collections",
      declarations: "let event;",
      setupTarget: "event",
      cleanupTarget: "event",
      eventExpression: "event",
      setupCollection: "setupEvents",
      cleanupCollection: "cleanupEvents",
    },
    {
      name: "the same collection conservatively",
      declarations: "let event;",
      setupTarget: "event",
      cleanupTarget: "event",
      eventExpression: "event",
      setupCollection: "setupEvents",
      cleanupCollection: "setupEvents",
    },
    {
      name: "destructured assignment targets",
      declarations: "let event; let metadata;",
      setupTarget: "[event, metadata]",
      cleanupTarget: "[event, metadata]",
      eventExpression: "event",
      setupCollection: "setupEntries",
      cleanupCollection: "cleanupEntries",
    },
    {
      name: "member assignment targets",
      declarations: 'const iterator = { event: "" };',
      setupTarget: "iterator.event",
      cleanupTarget: "iterator.event",
      eventExpression: "iterator.event",
      setupCollection: "setupEvents",
      cleanupCollection: "cleanupEvents",
    },
    {
      name: "computed member assignment targets",
      declarations: 'const iterator = { event: "" }; const eventKey = "event";',
      setupTarget: "iterator[eventKey]",
      cleanupTarget: "iterator[eventKey]",
      eventExpression: "iterator[eventKey]",
      setupCollection: "setupEvents",
      cleanupCollection: "cleanupEvents",
    },
  ])(
    "keeps assignment-form loops with $name diagnostic",
    ({
      declarations,
      setupTarget,
      cleanupTarget,
      eventExpression,
      setupCollection,
      cleanupCollection,
    }) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
const setupEvents = ["mousedown", "focusin"] as const;
const cleanupEvents = ["keydown"] as const;
const setupEntries = [["mousedown", 1], ["focusin", 2]] as const;
const cleanupEntries = [["keydown", 3]] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    ${declarations}
    for (${setupTarget} of ${setupCollection}) {
      document.addEventListener(${eventExpression}, onOutsideAction);
    }
    return () => {
      for (${cleanupTarget} of ${cleanupCollection}) {
        document.removeEventListener(${eventExpression}, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("rejects assignment-form iterator identity laundered through a shared binding", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const setupEvents = ["mousedown", "focusin"] as const;
const cleanupEvents = ["keydown"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    let iteratorEvent;
    let event;
    for (iteratorEvent of setupEvents) {
      event = iteratorEvent;
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (iteratorEvent of cleanupEvents) {
        event = iteratorEvent;
        document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an assignment-form iterator used through a nested declaration loop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const setupEvents = ["mousedown", "focusin"] as const;
const cleanupEvents = ["keydown"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    let event;
    for (event of setupEvents) {
      for (const attempt of [0]) document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (event of cleanupEvents) {
        for (const attempt of [0]) document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a stable event unrelated to an assignment-form loop target", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const items = [1, 2] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    let item;
    const event = "keydown";
    for (item of items) document.addEventListener(event, onOutsideAction);
    return () => document.removeEventListener(event, onOutsideAction);
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "setup iterator reassignment",
      setup:
        'for (let event of outsideActionEvents) { event = "keydown"; document.addEventListener(event, onOutsideAction); }',
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "cleanup iterator reassignment",
      setup:
        "for (const event of outsideActionEvents) document.addEventListener(event, onOutsideAction);",
      cleanup:
        'for (let event of outsideActionEvents) { event = "keydown"; document.removeEventListener(event, onOutsideAction); }',
    },
  ])("rejects $name", ({ setup, cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    ${setup}
    return () => {
      ${cleanup}
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a reassigned iterable",
      collectionDeclaration: 'let outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: 'outsideActionEvents = ["keydown"] as const;',
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "an exhausted one-shot iterator",
      collectionDeclaration:
        'const outsideActionEvents = (function* () { yield "mousedown"; yield "focusin"; })();',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "a mutable Set",
      collectionDeclaration: 'const outsideActionEvents = new Set(["mousedown", "focusin"]);',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "a mutable object event name",
      collectionDeclaration:
        'const eventName = { toString: () => "mousedown" }; const outsideActionEvents = [eventName];',
      beforeCleanup: 'eventName.toString = () => "keydown";',
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "an array mutated between setup and cleanup",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: 'outsideActionEvents.splice(0, 1, "keydown");',
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "an indexed array mutation between setup and cleanup",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: 'outsideActionEvents[0] = "keydown";',
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "mutation through an outbound const alias",
      collectionDeclaration:
        'const outsideActionEvents = ["mousedown", "focusin"] as const; const escapedEvents = outsideActionEvents;',
      beforeCleanup: "escapedEvents.pop();",
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "an exported outbound const alias",
      collectionDeclaration:
        'const outsideActionEvents = ["mousedown", "focusin"] as const; export const escapedEvents = outsideActionEvents;',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "an exported array that can escape the module",
      collectionDeclaration:
        'export const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);",
    },
    {
      name: "a conditional removal inside the loop",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) { if (shouldCleanup) document.removeEventListener(event, onOutsideAction); }",
    },
    {
      name: "an early break after the first removal",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) { document.removeEventListener(event, onOutsideAction); break; }",
    },
    {
      name: "an early return after the first removal",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) { document.removeEventListener(event, onOutsideAction); return; }",
    },
    {
      name: "a continue path before removal",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: "",
      cleanup:
        "for (const event of outsideActionEvents) { if (shouldCleanup) continue; document.removeEventListener(event, onOutsideAction); }",
    },
    {
      name: "a throw path after removal",
      collectionDeclaration: 'const outsideActionEvents = ["mousedown", "focusin"] as const;',
      beforeCleanup: "",
      cleanup:
        'for (const event of outsideActionEvents) { document.removeEventListener(event, onOutsideAction); throw new Error("stop"); }',
    },
  ])("rejects cleanup through $name", ({ collectionDeclaration, beforeCleanup, cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
${collectionDeclaration}
export const OutsideAction = ({ onOutsideAction, shouldCleanup }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    ${beforeCleanup}
    return () => {
      ${cleanup}
    };
  }, [onOutsideAction, shouldCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "handler reassignment",
      setupDeclaration: "let listener = onOutsideAction;",
      setupTarget: "document",
      setupHandler: "listener",
      beforeCleanup: "listener = onOtherAction;",
      cleanupTarget: "document",
      cleanupHandler: "listener",
      setupOptions: "",
      cleanupOptions: "",
    },
    {
      name: "receiver reassignment",
      setupDeclaration: "let target = document;",
      setupTarget: "target",
      setupHandler: "onOutsideAction",
      beforeCleanup: "target = window;",
      cleanupTarget: "target",
      cleanupHandler: "onOutsideAction",
      setupOptions: "",
      cleanupOptions: "",
    },
    {
      name: "a local receiver alias kept conservative",
      setupDeclaration: "const target = document;",
      setupTarget: "target",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "target",
      cleanupHandler: "onOutsideAction",
      setupOptions: "",
      cleanupOptions: "",
    },
    {
      name: "parseable const handler reassignment",
      setupDeclaration: "const listener = onOutsideAction;",
      setupTarget: "document",
      setupHandler: "listener",
      beforeCleanup: "listener = onOtherAction;",
      cleanupTarget: "document",
      cleanupHandler: "listener",
      setupOptions: "",
      cleanupOptions: "",
    },
    {
      name: "capture mismatch",
      setupDeclaration: "",
      setupTarget: "document",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "onOutsideAction",
      setupOptions: ", true",
      cleanupOptions: ", false",
    },
    {
      name: "capture omission mismatch",
      setupDeclaration: "",
      setupTarget: "document",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "onOutsideAction",
      setupOptions: ", true",
      cleanupOptions: "",
    },
    {
      name: "unknown mutable options",
      setupDeclaration: "const listenerOptions = getListenerOptions();",
      setupTarget: "document",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "onOutsideAction",
      setupOptions: ", listenerOptions",
      cleanupOptions: ", listenerOptions",
    },
    {
      name: "an unknown computed capture property",
      setupDeclaration: 'const captureKey = "capture";',
      setupTarget: "document",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "onOutsideAction",
      setupOptions: ", { [captureKey]: true }",
      cleanupOptions: "",
    },
    {
      name: "prototype-provided capture",
      setupDeclaration: "",
      setupTarget: "document",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "onOutsideAction",
      setupOptions: ", { __proto__: { capture: true } }",
      cleanupOptions: "",
    },
    {
      name: "a later unknown spread overriding capture",
      setupDeclaration: "",
      setupTarget: "document",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "onOutsideAction",
      setupOptions: ", { capture: true, ...unknownOptions }",
      cleanupOptions: ", true",
    },
    {
      name: "an unresolved global handler",
      setupDeclaration: "",
      setupTarget: "document",
      setupHandler: "globalHandler",
      beforeCleanup: "",
      cleanupTarget: "document",
      cleanupHandler: "globalHandler",
      setupOptions: "",
      cleanupOptions: "",
    },
    {
      name: "an unresolved global receiver",
      setupDeclaration: "",
      setupTarget: "externalTarget",
      setupHandler: "onOutsideAction",
      beforeCleanup: "",
      cleanupTarget: "externalTarget",
      cleanupHandler: "onOutsideAction",
      setupOptions: "",
      cleanupOptions: "",
    },
  ])(
    "rejects loop pairing with $name",
    ({
      setupDeclaration,
      setupTarget,
      setupHandler,
      beforeCleanup,
      cleanupTarget,
      cleanupHandler,
      setupOptions,
      cleanupOptions,
    }) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction, onOtherAction }) => {
  useEffect(() => {
    ${setupDeclaration}
    for (const event of outsideActionEvents) {
      ${setupTarget}.addEventListener(event, ${setupHandler}${setupOptions});
    }
    ${beforeCleanup}
    return () => {
      for (const event of outsideActionEvents) {
        ${cleanupTarget}.removeEventListener(event, ${cleanupHandler}${cleanupOptions});
      }
    };
  }, [onOtherAction, onOutsideAction]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("rejects a for-of and forEach cross-shape pair conservatively", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      outsideActionEvents.forEach((event) => {
        document.removeEventListener(event, onOutsideAction);
      });
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects distinct handler snapshots from the same mutable member", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ handlers, onOtherAction }) => {
  useEffect(() => {
    const setupHandler = handlers.current;
    for (const event of outsideActionEvents) {
      document.addEventListener(event, setupHandler);
    }
    handlers.current = onOtherAction;
    const cleanupHandler = handlers.current;
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, cleanupHandler);
      }
    };
  }, [handlers, onOtherAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects distinct immutable aliases even when their initializers look equivalent", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ handlers }) => {
  useEffect(() => {
    const setupHandler = handlers.current;
    const cleanupHandler = handlers.current;
    for (const event of outsideActionEvents) {
      document.addEventListener(event, setupHandler);
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, cleanupHandler);
      }
    };
  }, [handlers]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a conditionally invoked cleanup-loop helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction, shouldCleanup }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    const removeOutsideActionListeners = () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
    return () => {
      if (shouldCleanup) removeOutsideActionListeners();
    };
  }, [onOutsideAction, shouldCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "direct loops",
      cleanup: `if (useFirstCleanup) {
        for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);
      } else {
        for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction);
      }`,
    },
    {
      name: "helper calls",
      cleanup: `if (useFirstCleanup) {
        removeOutsideActionListeners();
      } else {
        removeOutsideActionListeners();
      }`,
    },
  ])("accepts exhaustive complementary $name", ({ cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction, useFirstCleanup }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    const removeOutsideActionListeners = () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
    return () => {
      ${cleanup}
    };
  }, [onOutsideAction, useFirstCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a later unconditional cleanup helper call after a conditional call", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction, shouldCleanupEarly }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    const removeOutsideActionListeners = () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
    return () => {
      if (shouldCleanupEarly) removeOutsideActionListeners();
      removeOutsideActionListeners();
    };
  }, [onOutsideAction, shouldCleanupEarly]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "generator cleanup whose body is never executed",
      cleanup:
        "return function* cleanup() { for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction); };",
    },
    {
      name: "async cleanup with deferred removal",
      cleanup:
        "return async () => { await Promise.resolve(); for (const event of outsideActionEvents) document.removeEventListener(event, onOutsideAction); };",
    },
  ])("rejects a $name", ({ cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    ${cleanup}
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects loop cleanup returned from an async effect callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(async () => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps generic on/off loops conservative because listener identity is library-specific", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["invalidate", "refresh"] as const;
export const Subscriber = ({ socket, listener }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) socket.on(event, listener, "setup-scope");
    return () => {
      for (const event of outsideActionEvents) socket.off(event, listener, "cleanup-scope");
    };
  }, [listener, socket]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let one generic off loop satisfy duplicate on registrations", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["invalidate", "refresh"] as const;
export const Subscriber = ({ socket, listener }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      socket.on(event, listener);
      socket.on(event, listener);
    }
    return () => {
      for (const event of outsideActionEvents) socket.off(event, listener);
    };
  }, [listener, socket]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a locally shadowed document",
      declaration: "const document = customDocument;",
      receiver: "document",
    },
    {
      name: "globalThis.document",
      declaration: "",
      receiver: "globalThis.document",
    },
  ])("keeps $name conservative", ({ declaration, receiver }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ customDocument, onOutsideAction }) => {
  ${declaration}
  useEffect(() => {
    for (const event of outsideActionEvents) ${receiver}.addEventListener(event, onOutsideAction);
    return () => {
      for (const event of outsideActionEvents) ${receiver}.removeEventListener(event, onOutsideAction);
    };
  }, [customDocument, onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains the unmatched capture tuple when one of two registrations is cleaned up", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction, false);
      document.addEventListener(event, onOutsideAction, true);
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction, false);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains the unmatched handler when one of two listeners is cleaned up", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ firstHandler, secondHandler }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, firstHandler);
      document.addEventListener(event, secondHandler);
    }
    return () => {
      for (const event of outsideActionEvents) document.removeEventListener(event, firstHandler);
    };
  }, [firstHandler, secondHandler]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("pairs listener options that differ only outside capture semantics", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction, { capture: true, passive: true, once: true });
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction, { capture: true, passive: false });
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts transparent TypeScript wrappers around the direct DOM tuple", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      (document as Document)!.addEventListener((event as string)!, onOutsideAction!);
    }
    return () => {
      for (const event of outsideActionEvents) {
        (document as Document)!.removeEventListener((event as string)!, onOutsideAction!);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects matching for-await loops because cleanup is deferred", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(async () => {
    for await (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return async () => {
      for await (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not crash or falsely match a recursive cleanup helper cycle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction, shouldRecurse }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) document.addEventListener(event, onOutsideAction);
    const removeOutsideActionListeners = () => {
      if (shouldRecurse) removeOutsideActionListeners();
    };
    const cleanupAlias = removeOutsideActionListeners;
    return () => cleanupAlias();
  }, [onOutsideAction, shouldRecurse]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a break-truncated removal loop in a retained handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `const probeEvents = ["mousedown", "focusin"];
export const Tracker = () => {
  const onMove = (event) => console.log(event.type);
  const arm = () => {
    for (const event of probeEvents) {
      document.addEventListener(event, onMove);
    }
  };
  const disarm = () => {
    for (const event of probeEvents) {
      document.removeEventListener(event, onMove);
      break;
    }
  };
  return <button onClick={arm} onBlur={disarm}>track</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an exhaustive removal loop in a retained handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `const probeEvents = ["mousedown", "focusin"];
export const Tracker = () => {
  const onMove = (event) => console.log(event.type);
  const arm = () => {
    for (const event of probeEvents) {
      document.addEventListener(event, onMove);
    }
  };
  const disarm = () => {
    for (const event of probeEvents) {
      document.removeEventListener(event, onMove);
    }
  };
  return <button onClick={arm} onBlur={disarm}>track</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a break-truncated removal loop in the returned effect cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const outsideActionEvents = ["mousedown", "focusin"] as const;
export const OutsideAction = ({ onOutsideAction }) => {
  useEffect(() => {
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
        break;
      }
    };
  }, [onOutsideAction]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

interface RefOwnedKeepCase {
  name: string;
  modulePrelude?: string;
  releaseStatement?: string;
  unmountEffect?: string;
  sessionAssignment?: string;
  setupListener?: string;
}

describe("effect-needs-cleanup ref-owned retained listener cleanup", () => {
  it("accepts exact ref-owned listeners released by a stable unmount cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = () => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (session) {
      document.removeEventListener("mousemove", session.handleMouseMove);
      document.removeEventListener("mouseup", session.handleMouseUp);
      activeSessionRef.current = null;
    }
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = (event) => console.log(event.clientX);
    const handleMouseUp = () => stopResize();
    activeSessionRef.current = { handleMouseMove, handleMouseUp };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a block effect that returns the cleanup with other dependencies", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ cookieName }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => {
    console.log(cookieName);
    return stopResize;
  }, [cookieName, stopResize]);
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = (event) => console.log(event.clientX);
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, []);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a retained setup that can overwrite a previous ref-owned listener", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = () => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    const handleMouseMove = () => undefined;
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, []);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "conditional pre-release",
      setupPrefix: "if (enabled) stopResize();",
      setupSuffix: "",
    },
    {
      name: "deferred release",
      setupPrefix: "queueMicrotask(stopResize);",
      setupSuffix: "",
    },
    {
      name: "nested callback release",
      setupPrefix: "const releaseLater = () => stopResize(); releaseLater;",
      setupSuffix: "",
    },
    {
      name: "one-branch release",
      setupPrefix: "if (enabled) stopResize(); else console.log('disabled');",
      setupSuffix: "",
    },
    {
      name: "release after storage",
      setupPrefix: "",
      setupSuffix: "stopResize();",
    },
  ])("keeps a $name setup diagnostic", ({ setupPrefix, setupSuffix }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ enabled }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    ${setupPrefix}
    const handleMouseMove = () => undefined;
    activeSessionRef.current = { handleMouseMove };
    ${setupSuffix}
    document.addEventListener("mousemove", handleMouseMove);
  }, [enabled, stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps multiple session storage sites conservative", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ enabled }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    const handleMouseMove = () => undefined;
    if (enabled) {
      stopResize();
      activeSessionRef.current = { handleMouseMove };
    } else {
      activeSessionRef.current = { handleMouseMove };
    }
    document.addEventListener("mousemove", handleMouseMove);
  }, [enabled, stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "guarded setup after an early return",
      setupPrefix: "if (!enabled) return; stopResize();",
    },
    {
      name: "release in both branches",
      setupPrefix: "if (enabled) stopResize(); else stopResize();",
    },
  ])("accepts $name", ({ setupPrefix }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ enabled }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    ${setupPrefix}
    const handleMouseMove = () => undefined;
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, [enabled, stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "react callback with changing dependencies",
      cleanupDefinition: `const stopResize = useCallback(() => {
        const session = activeSessionRef.current;
        if (!session) return;
        document.removeEventListener("mousemove", session.handleMouseMove);
        activeSessionRef.current = null;
      }, [enabled]);`,
    },
    {
      name: "immutable local arrow function",
      cleanupDefinition: `const stopResize = () => {
        const session = activeSessionRef.current;
        if (!session) return;
        document.removeEventListener("mousemove", session.handleMouseMove);
        activeSessionRef.current = null;
      };`,
    },
    {
      name: "local function declaration",
      cleanupDefinition: `function stopResize() {
        const session = activeSessionRef.current;
        if (!session) return;
        document.removeEventListener("mousemove", session.handleMouseMove);
        activeSessionRef.current = null;
      }`,
    },
  ])("accepts cleanup owned by a $name", ({ cleanupDefinition }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ enabled }) => {
  const activeSessionRef = useRef(null);
  ${cleanupDefinition}
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = (event) => console.log(event.clientX);
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, []);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an unmount effect returning the cleanup from both branches", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ enabled }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => {
    if (enabled) {
      return stopResize;
    } else {
      return stopResize;
    }
  }, [enabled, stopResize]);
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = () => undefined;
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, [stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps an async cleanup function diagnostic", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = () => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = () => undefined;
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, [stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a loop-stored session registration diagnostic", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const useResizableColumns = ({ columns }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    for (const column of columns) {
      const handleMouseMove = (event) => console.log(column, event.clientX);
      activeSessionRef.current = { handleMouseMove };
      document.addEventListener("mousemove", handleMouseMove);
    }
  }, [columns, stopResize]);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  const refOwnedKeepCases: RefOwnedKeepCase[] = [
    { name: "no unmount effect", unmountEffect: "" },
    {
      name: "effect invocation without a returned cleanup",
      unmountEffect: "useEffect(() => { stopResize(); }, [stopResize]);",
    },
    {
      name: "conditional unmount return",
      unmountEffect:
        "useEffect(() => { if (enabled) return stopResize; return undefined; }, [enabled, stopResize]);",
    },
    {
      name: "mismatched event name",
      releaseStatement: 'document.removeEventListener("mouseup", session.handleMouseMove);',
    },
    {
      name: "mismatched target",
      releaseStatement: 'window.removeEventListener("mousemove", session.handleMouseMove);',
    },
    {
      name: "mismatched stored callback",
      releaseStatement: 'document.removeEventListener("mousemove", session.handleMouseUp);',
      sessionAssignment: "activeSessionRef.current = { handleMouseMove, handleMouseUp: () => {} };",
    },
    {
      name: "unrelated conditional removal",
      releaseStatement:
        'if (enabled) document.removeEventListener("mousemove", session.handleMouseMove);',
    },
    {
      name: "unsafe ref overwrite",
      sessionAssignment:
        "activeSessionRef.current = { handleMouseMove }; activeSessionRef.current = null;",
    },
    {
      name: "stored handler overwrite",
      sessionAssignment:
        "activeSessionRef.current = { handleMouseMove }; activeSessionRef.current.handleMouseMove = () => {};",
    },
    {
      name: "stored handler deletion",
      sessionAssignment:
        "activeSessionRef.current = { handleMouseMove }; delete activeSessionRef.current.handleMouseMove;",
    },
    {
      name: "computed stored handler overwrite",
      sessionAssignment:
        'activeSessionRef.current = { handleMouseMove }; activeSessionRef.current["handleMouseMove"] = () => {};',
    },
    {
      name: "computed stored handler deletion",
      sessionAssignment:
        'activeSessionRef.current = { handleMouseMove }; delete activeSessionRef.current["handleMouseMove"];',
    },
    {
      name: "Object.assign stored handler overwrite",
      sessionAssignment:
        "activeSessionRef.current = { handleMouseMove }; Object.assign(activeSessionRef.current, { handleMouseMove: () => {} });",
    },
    {
      name: "trailing spread session storage",
      sessionAssignment: "activeSessionRef.current = { handleMouseMove, ...previousSession };",
    },
    {
      name: "ref escape to a session-resetting helper",
      modulePrelude: "const resetSession = (ref) => {\n  ref.current = null;\n};",
      sessionAssignment:
        "activeSessionRef.current = { handleMouseMove }; resetSession(activeSessionRef);",
    },
    {
      name: "unrelated early-return before release",
      releaseStatement:
        'if (!enabled) return;\n    document.removeEventListener("mousemove", session.handleMouseMove);',
    },
    {
      name: "duplicate stored handler keys",
      sessionAssignment:
        "activeSessionRef.current = { handleMouseMove, backupHandler: handleMouseMove };",
    },
    {
      name: "partial removal of one of two listeners",
      sessionAssignment:
        "const handleMouseUp = () => undefined; activeSessionRef.current = { handleMouseMove, handleMouseUp };",
      setupListener:
        'document.addEventListener("mousemove", handleMouseMove); document.addEventListener("mouseup", handleMouseUp);',
    },
    {
      name: "named effect callback",
      unmountEffect:
        "const unmountEffect = () => stopResize; useEffect(unmountEffect, [stopResize]);",
    },
    {
      name: "capture mismatch",
      setupListener: 'document.addEventListener("mousemove", handleMouseMove, true);',
    },
    {
      name: "non-global listener target",
      releaseStatement: 'target.removeEventListener("mousemove", session.handleMouseMove);',
      setupListener: 'target.addEventListener("mousemove", handleMouseMove);',
    },
    {
      name: "non-literal event name",
      releaseStatement: "document.removeEventListener(eventName, session.handleMouseMove);",
      setupListener: "document.addEventListener(eventName, handleMouseMove);",
    },
  ];

  it.each(refOwnedKeepCases)(
    "keeps $name diagnostic",
    ({
      modulePrelude = "",
      releaseStatement = 'document.removeEventListener("mousemove", session.handleMouseMove);',
      unmountEffect = "useEffect(() => stopResize, [stopResize]);",
      sessionAssignment = "activeSessionRef.current = { handleMouseMove };",
      setupListener = 'document.addEventListener("mousemove", handleMouseMove);',
    }) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useCallback, useEffect, useRef } from "react";
${modulePrelude}
export const useResizableColumns = ({ enabled, eventName, target, previousSession }) => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    ${releaseStatement}
    activeSessionRef.current = null;
  }, []);
  ${unmountEffect}
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = (event) => console.log(event.clientX);
    ${sessionAssignment}
    ${setupListener}
  }, [stopResize]);
  return startResize;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    {
      name: "shadowed useEffect",
      imports: "useCallback, useRef",
      shadow: "const useEffect = (callback) => callback();",
    },
    {
      name: "shadowed useRef",
      imports: "useCallback, useEffect",
      shadow: "const useRef = (value) => ({ current: value });",
    },
  ])("keeps cleanup through $name conservative", ({ imports, shadow }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { ${imports} } from "react";
${shadow}
export const useResizableColumns = () => {
  const activeSessionRef = useRef(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    document.removeEventListener("mousemove", session.handleMouseMove);
    activeSessionRef.current = null;
  }, []);
  useEffect(() => stopResize, [stopResize]);
  const startResize = useCallback(() => {
    stopResize();
    const handleMouseMove = () => undefined;
    activeSessionRef.current = { handleMouseMove };
    document.addEventListener("mousemove", handleMouseMove);
  }, []);
  return startResize;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup adversarial edge cases (observers / connections / retained functions)", () => {
  it("flags an observer registered through a nested helper with no cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Measurer = ({ el }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    const attach = () => { observer.observe(el); };
    attach();
  }, [el]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag cleanup via optional call `observer.disconnect?.()`", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Measurer = ({ el }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect?.();
  }, [el]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag cleanup through a captured alias of the observer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Measurer = ({ el }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    const captured = observer;
    return () => captured.disconnect();
  }, [el]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags returning the observer handle itself as cleanup (disconnects nothing)", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Measurer = ({ el }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return observer;
  }, [el]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a WebSocket opened and closed synchronously in the same effect body", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const PingOnce = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    socket.send("ping");
    socket.close();
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a subscription removed synchronously in the same effect body", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ReadOnce = ({ store }) => {
  useEffect(() => {
    const subscription = store.subscribe(update);
    readCurrentValue();
    subscription.remove();
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a subscribe disposer invoked synchronously in the same effect body", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ReadOnce = ({ store }) => {
  useEffect(() => {
    const unsubscribe = store.subscribe(update);
    readCurrentValue();
    unsubscribe();
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an observer disconnected at statement level after a one-shot measure", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const MeasureOnce = ({ el }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    measure();
    observer.disconnect();
  }, [el]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a release-then-register pair — the trailing registration leaks", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Retarget = ({ emitter, handler }) => {
  useEffect(() => {
    emitter.off("change", handler);
    emitter.on("change", handler);
  }, [emitter, handler]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags debounce-style clearTimeout-then-setTimeout without a cleanup return", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a timer released before replacement and by a stable unmount effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a handle-guarded release before timer replacement", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts one-shot timer cleanup owned by a stable unmount effect after an early return", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ enabled, value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [enabled, value]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts one-shot timer cleanup owned by a stable unmount effect inside a condition", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ enabled, value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    if (enabled) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => commit(value), 300);
    }
  }, [enabled, value]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects repeating timer cleanup when an early return skips the rerun release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Poller = ({ enabled, value }) => {
  const intervalRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => poll(value), 300);
  }, [enabled, value]);
  useEffect(() => () => clearInterval(intervalRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects one-shot timer cleanup when rerenders can overwrite a live handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DeferredCommit = ({ value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects one-shot timer cleanup when a separate guard can skip the rerun release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DeferredCommit = ({ shouldRelease, value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    if (shouldRelease) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [shouldRelease, value]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts helper-mediated rerun and unmount cleanup for the same timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ value }) => {
  const timeoutRef = useRef(null);
  const clearTimer = () => clearTimeout(timeoutRef.current);
  useEffect(() => {
    clearTimer();
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  useEffect(() => clearTimer, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects split cleanup that releases a different timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ value }) => {
  const timeoutRef = useRef(null);
  const otherTimeoutRef = useRef(null);
  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  useEffect(() => () => clearTimeout(otherTimeoutRef.current), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects split cleanup that is not returned on every unmount-effect path", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Debounced = ({ enabled, value }) => {
  const timeoutRef = useRef(null);
  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => commit(value), 300);
  }, [value]);
  useEffect(() => {
    if (enabled) return () => clearTimeout(timeoutRef.current);
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a release method bound to its subscription receiver", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ store }) => {
  useEffect(() => {
    const subscription = store.subscribe(update);
    return subscription.unsubscribe.bind(subscription);
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an aliased release method bound to its subscription receiver", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ store }) => {
  useEffect(() => {
    const subscription = store.subscribe(update);
    const cleanup = subscription.unsubscribe.bind(subscription);
    return cleanup;
  }, [store]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a release method bound to a different subscription receiver", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ store, otherSubscription }) => {
  useEffect(() => {
    const subscription = store.subscribe(update);
    return subscription.unsubscribe.bind(otherSubscription);
  }, [store, otherSubscription]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a nested-callback release — only statement-level releases neutralize", () => {
    // `socket.onclose = () => socket.close()` runs later, if ever — it must
    // NOT count as a synchronous release.
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    socket.onerror = () => socket.close();
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a socket stored on a ref whose close lives in a different effect", () => {
    // Cross-effect cleanup is not honored: the constructing effect re-runs
    // on dep change and leaks the previous socket — cleanup must be returned
    // from the effect that opened the connection.
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const Feed = ({ url }) => {
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = new WebSocket(url);
  }, [url]);
  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag conditional construction with an unconditional optional-chained cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const MaybeLive = ({ live, url }) => {
  useEffect(() => {
    let socket;
    if (live) { socket = new WebSocket(url); }
    return () => socket?.close();
  }, [live, url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an observer created and registered inside an IIFE in the effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const DomWatcher = () => {
  useEffect(() => {
    (() => {
      const observer = new MutationObserver(() => update());
      observer.observe(document.body, { childList: true });
    })();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not crash and still flags `new EventSource(url, { signal })` (no such option) without cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const ServerEvents = ({ url, signal }) => {
  useEffect(() => {
    const source = new EventSource(url, { signal });
    source.onmessage = (event) => update(event.data);
  }, [url, signal]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not crash on a computed connection class `new (getSocketClass())(url)`", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Dynamic = ({ url }) => {
  useEffect(() => {
    const socket = new (getSocketClass())(url);
    socket.onmessage = update;
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a computed `observer["observe"](el)` registration (dynamic name — abstain)', () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Computed = ({ el }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => update());
    observer["observe"](el);
  }, [el]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves identifier-computed subscribe detection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `function Example({ source, subscribe }) {
        useEffect(() => {
          source[subscribe](() => refresh());
        }, [source, subscribe]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a retained function whose setInterval id is captured but never cleared", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useState } from "react";
export const Poller = () => {
  const [timerId, setTimerId] = useState(null);
  const start = () => {
    setTimerId(setInterval(() => tick(), 1000));
  };
  return <button onClick={start}>go</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a concise-body interval factory — the id escapes to the caller", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Poller = () => {
  const schedule = useCallback(() => setInterval(() => poll(), 1000), []);
  return <button onClick={() => clearInterval(schedule())}>toggle</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags `void setInterval(...)` in a retained handler — void is an explicit discard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Ticker = () => {
  const start = () => {
    void setInterval(() => tick(), 1000);
  };
  return <button onClick={start}>tick</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores an unreferenced component-scope function that cannot acquire a resource", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Idle = () => {
  function startPolling() {
    setInterval(() => poll(), 1000);
  }
  return <div />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `{ "once": true }` listener registered with a string-literal key', () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const OneShot = () => {
  const arm = () => {
    window.addEventListener("pointerup", () => finish(), { "once": true });
  };
  return <button onPointerDown={arm}>press</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a literal `{ once: false }` listener — it does not self-release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const NotOnce = () => {
  const arm = () => {
    window.addEventListener("pointerup", () => finish(), { once: false });
  };
  return <button onPointerDown={arm}>press</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup retained-resource correlation", () => {
  it("checks useInsertionEffect for retained resources", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useInsertionEffect } from "react";
export const Styles = ({ registry }) => {
  useInsertionEffect(() => {
    registry.subscribe(syncStyles);
  }, [registry]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("in useInsertionEffect");
  });

  it("accepts a matching useInsertionEffect cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useInsertionEffect } from "react";
export const Styles = ({ registry }) => {
  useInsertionEffect(() => {
    const unsubscribe = registry.subscribe(syncStyles);
    return unsubscribe;
  }, [registry]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let cleanup for one socket hide another socket", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ primaryUrl, secondaryUrl }) => {
  useEffect(() => {
    const primary = new WebSocket(primaryUrl);
    const secondary = new WebSocket(secondaryUrl);
    return () => primary.close();
  }, [primaryUrl, secondaryUrl]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("WebSocket");
  });

  it("does not let an unrelated timer cleanup suppress a recurring timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Poller = () => {
  useEffect(() => {
    const pollingId = setInterval(poll, 1000);
    const animationId = setInterval(animate, 16);
    return () => clearInterval(animationId);
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let an unrelated listener removal suppress a registration", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = ({ firstTarget, secondTarget, handler }) => {
  useEffect(() => {
    firstTarget.addEventListener("change", handler);
    return () => secondTarget.removeEventListener("change", handler);
  }, [firstTarget, secondTarget, handler]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let an opaque cleanup call suppress another resource leak", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LiveFeed = ({ firstUrl, secondUrl }) => {
  useEffect(() => {
    const firstSocket = new WebSocket(firstUrl);
    const secondSocket = new WebSocket(secondUrl);
    return () => {
      firstSocket.close();
      recordCleanup();
    };
  }, [firstUrl, secondUrl]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat `return undefined` as resource cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const LiveFeed = ({ url, disabled }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    if (disabled) return undefined;
    socket.onmessage = update;
  }, [url, disabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a recurring timer in an inline JSX handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Poller = () => (
  <button onClick={() => setInterval(poll, 1000)}>start</button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a recurring timer in an inline config handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Feed = () => {
  useConnection({ onOpen: () => setInterval(poll, 1000) });
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the one-shot setTimeout exemption for inline handlers", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Toast = () => (
  <button onClick={() => setTimeout(hideToast, 3000)}>show</button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("effect-needs-cleanup path and reachability correlation", () => {
  it("flags a resource when only one return path supplies matching cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, shouldCleanup }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    if (shouldCleanup) return () => socket.close();
    return undefined;
  }, [url, shouldCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts cleanup on every branch that acquires its resource", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ primaryUrl, secondaryUrl, usePrimary }) => {
  useEffect(() => {
    if (usePrimary) {
      const primary = new WebSocket(primaryUrl);
      return () => primary.close();
    }
    const secondary = new WebSocket(secondaryUrl);
    return () => secondary.close();
  }, [primaryUrl, secondaryUrl, usePrimary]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a resource released synchronously on only one path", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, shouldClose }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    if (shouldClose) socket.close();
  }, [url, shouldClose]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a retained listener whose local AbortController can never be aborted", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Listener = () => (
  <button
    onClick={() => {
      const controller = new AbortController();
      window.addEventListener("resize", update, { signal: controller.signal });
    }}
  >
    listen
  </button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a retained listener whose local AbortController is aborted by a reachable handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const Listener = () => {
  const controller = new AbortController();
  const listen = () => {
    window.addEventListener("resize", update, { signal: controller.signal });
  };
  const stop = () => controller.abort();
  return <button onClick={listen} onBlur={stop}>listen</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a replaced AbortController retained through a ref and aborted on unmount", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const Listener = () => {
  const controllerRef = useRef(null);
  const listen = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    window.addEventListener("resize", update, { signal });
  }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);
  return <button onClick={listen}>listen</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a retained AbortController ref without replacement cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const Listener = () => {
  const controllerRef = useRef(null);
  const listen = useCallback(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    window.addEventListener("resize", update, { signal: controller.signal });
  }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);
  return <button onClick={listen}>listen</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a retained AbortController ref with conditional replacement cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const Listener = ({ shouldAbort }) => {
  const controllerRef = useRef(null);
  const listen = useCallback(() => {
    if (shouldAbort) controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    window.addEventListener("resize", update, { signal: controller.signal });
  }, [shouldAbort]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  return <button onClick={listen}>listen</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a retained AbortController ref without unmount cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Listener = () => {
  const controllerRef = useRef(null);
  const listen = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    window.addEventListener("resize", update, { signal: controller.signal });
  }, []);
  return <button onClick={listen}>listen</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects retaining an AbortController only after listener registration", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
export const Listener = () => {
  const controllerRef = useRef(null);
  const listen = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    window.addEventListener("resize", update, { signal: controller.signal });
    controllerRef.current = controller;
  }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);
  return <button onClick={listen}>listen</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a resource acquisition inside an uncalled nested function", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url }) => {
  useEffect(() => {
    const openUnusedSocket = () => new WebSocket(url);
    void openUnusedSocket;
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let an unreachable release function suppress a retained listener leak", () => {
    const result = runRule(
      effectNeedsCleanup,
      `export const KeyTracker = () => {
  const onKeyDown = (event) => track(event.key);
  const armListener = () => {
    window.addEventListener("keydown", onKeyDown);
  };
  const unusedDisarmListener = () => {
    window.removeEventListener("keydown", onKeyDown);
  };
  return <button onClick={armListener}>arm</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an opaque cleanup identifier for a locally owned connection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, opaqueCleanup }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    return opaqueCleanup;
  }, [url, opaqueCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts map-created timers cleared through the same collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map(() => setInterval(poll, 1000));
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a local timer returned from a block-bodied map callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map(() => {
      const timerId = setInterval(poll, 1000);
      return timerId;
    });
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a map callback that returns a value other than its local timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map((item) => {
      const timerId = setInterval(poll, 1000);
      return item.id;
    });
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a map callback that conditionally mixes timers with other values", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map((item) => {
      const timerId = setInterval(poll, 1000);
      if (item.disabled) return null;
      return timerId;
    });
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a map callback that can exit after scheduling before returning the timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map((item) => {
      const timerId = setInterval(poll, 1000);
      if (item.invalid) throw new Error("invalid");
      return timerId;
    });
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a timer handle returned from a filter callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.filter(() => setInterval(poll, 1000));
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects cleanup through a different timer collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items, previousTimerIds }) => {
  useEffect(() => {
    const timerIds = items.map(() => {
      const timerId = setInterval(poll, 1000);
      return timerId;
    });
    return () => previousTimerIds.forEach((timerId) => clearInterval(timerId));
  }, [items, previousTimerIds]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects the wrong clear verb for a mapped interval collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map(() => {
      const timerId = setInterval(poll, 1000);
      return timerId;
    });
    return () => timerIds.forEach((timerId) => clearTimeout(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a local mapped timer that is not returned", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Pollers = ({ items }) => {
  useEffect(() => {
    const timerIds = items.map(() => {
      const timerId = setInterval(poll, 1000);
      track(timerId);
    });
    return () => timerIds.forEach((timerId) => clearInterval(timerId));
  }, [items]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup stable aliases and indirect cleanup helpers", () => {
  it("accepts an unreassigned let cleanup alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    let cleanup = () => socket.close();
    const cleanupAlias = cleanup;
    return cleanupAlias;
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an unreassigned var listener options alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = () => {
  useEffect(() => {
    const controller = new AbortController();
    var options = { signal: controller.signal };
    window.addEventListener("resize", update, options);
    return () => controller.abort();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a reassigned cleanup alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, skipCleanup }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    let cleanup = () => socket.close();
    if (skipCleanup) cleanup = () => {};
    return cleanup;
  }, [url, skipCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a cleanup alias reassigned through destructuring", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, replacement }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    let cleanup = () => socket.close();
    ({ cleanup } = replacement);
    return cleanup;
  }, [url, replacement]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a reassigned listener options alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = ({ useOtherSignal }) => {
  useEffect(() => {
    const controller = new AbortController();
    const otherController = new AbortController();
    let options = { signal: controller.signal };
    if (useOtherSignal) options = { signal: otherController.signal };
    window.addEventListener("resize", update, options);
    return () => controller.abort();
  }, [useOtherSignal]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a socket released by a transitively invoked local helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    const closeSocket = () => socket.close();
    const releaseConnection = () => closeSocket();
    return () => releaseConnection();
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a timer released by an invoked local helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Poller = () => {
  useEffect(() => {
    const timerId = setInterval(poll, 1000);
    const stopPolling = () => clearInterval(timerId);
    return () => stopPolling();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a listener released by an invoked local helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Listener = ({ target, handler }) => {
  useEffect(() => {
    target.addEventListener("change", handler);
    const stopListening = () => target.removeEventListener("change", handler);
    return () => stopListening();
  }, [target, handler]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a reassigned cleanup helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, skipCleanup }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    let closeSocket = () => socket.close();
    if (skipCleanup) closeSocket = () => {};
    return () => closeSocket();
  }, [url, skipCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not correlate a helper that releases another resource", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url, otherSocket }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    const closeSocket = () => otherSocket.close();
    return () => closeSocket();
  }, [url, otherSocket]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("terminates cyclic helper traversal without inventing cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Feed = ({ url }) => {
  useEffect(() => {
    const socket = new WebSocket(url);
    const firstCleanup = () => secondCleanup();
    const secondCleanup = () => firstCleanup();
    return () => firstCleanup();
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup CLI integration correlation", () => {
  it("rejects cleanup methods called on an unrelated resource", () => {
    for (const releaseName of ["remove", "cleanup", "dispose", "destroy", "teardown"]) {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
declare const node: { ${releaseName}: () => void };
export const Resize = () => {
  useEffect(() => {
    window.addEventListener("resize", () => {});
    return () => {
      node.${releaseName}();
    };
  }, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects a returned helper that does not clear its timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
declare const track: () => void;
export const Clock = () => {
  useEffect(() => {
    setInterval(track, 1000);
    const stopInterval = () => {
      track();
    };
    return stopInterval;
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an undefined cleanup binding shadowed inside its installer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
declare const tick: () => void;
export const Clock = () => {
  useEffect(() => {
    const id = setInterval(tick, 1000);
    let stopInterval: (() => void) | undefined;
    const install = () => {
      const stopInterval = () => clearInterval(id);
      return stopInterval;
    };
    install();
    return stopInterval;
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a ref timer started and stopped through synchronous helpers", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef, useState } from "react";
export const Clock = () => {
  const [, setTick] = useState(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const startInterval = () => {
      if (intervalIdRef.current) return;
      intervalIdRef.current = setInterval(() => setTick((state) => state + 1), 1000);
    };
    const stopInterval = () => {
      if (!intervalIdRef.current) return;
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    };
    startInterval();
    return stopInterval;
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a listener disposer assigned by a synchronous subscribe helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
declare const win: Window;
declare const updatePixelRatio: () => void;
export const Resolution = () => {
  useEffect(() => {
    let remove: (() => void) | null = null;
    const subscribe = () => {
      const media = win.matchMedia("(resolution: 1dppx)");
      media.addEventListener("change", updatePixelRatio);
      remove = () => {
        media.removeEventListener("change", updatePixelRatio);
      };
    };
    subscribe();
    return () => {
      remove?.();
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts matching modern and legacy media listener branches", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const MediaQuery = ({ breakpoint }) => {
  useEffect(() => {
    const media = window.matchMedia(breakpoint);
    const handleMatch = () => update(media.matches);
    handleMatch();
    if (media.addEventListener) {
      media.addEventListener("change", handleMatch);
      return () => media.removeEventListener("change", handleMatch);
    }
    media.addListener(handleMatch);
    return () => media.removeListener(handleMatch);
  }, [breakpoint]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts matching listener setup and cleanup through nested ref collections", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          const enabledEvents = [];
          enabledEvents.push({ event: "focus", listener: handleFocus, capture: true });

          enabledEvents.forEach(({ event, listener, capture }) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(event, listener, capture);
            });
          });

          return () => {
            enabledEvents.forEach(({ event, listener, capture }) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.removeEventListener(event, listener, capture);
              });
            });
          };
        }, [anchorRefs]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts matching nonliteral capture values in inline option bags", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function OutsideAction({ capture, onOutsideAction }) {
        useEffect(() => {
          document.addEventListener("focusin", onOutsideAction, { capture, passive: true });
          return () => {
            document.removeEventListener("focusin", onOutsideAction, { capture, passive: false });
          };
        }, [capture, onOutsideAction]);

        return null;
      }
    `,
      { filename: "OutsideAction.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects different nonliteral capture values in inline option bags", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function OutsideAction({ capture, cleanupCapture, onOutsideAction }) {
        useEffect(() => {
          document.addEventListener("focusin", onOutsideAction, { capture });
          return () => {
            document.removeEventListener("focusin", onOutsideAction, {
              capture: cleanupCapture,
            });
          };
        }, [capture, cleanupCapture, onOutsideAction]);

        return null;
      }
    `,
      { filename: "OutsideAction.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not collide opaque listener options with an inline capture value", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function OutsideAction({ listenerOptions, onOutsideAction }) {
        useEffect(() => {
          document.addEventListener("focusin", onOutsideAction, listenerOptions);
          return () => {
            document.removeEventListener("focusin", onOutsideAction, {
              capture: listenerOptions,
            });
          };
        }, [listenerOptions, onOutsideAction]);

        return null;
      }
    `,
      { filename: "OutsideAction.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "conditional cleanup",
      beforeCleanup: "",
      cleanup: `
        if (shouldCleanup) {
          document.removeEventListener(event, handler, { capture });
        }
      `,
    },
    {
      name: "post-registration collection mutation",
      beforeCleanup: "subscriptions.pop();",
      cleanup: "document.removeEventListener(event, handler, { capture });",
    },
  ])("rejects projected option-bag capture with $name", ({ beforeCleanup, cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function OutsideActions({ shouldCleanup, subscriptions }) {
        useEffect(() => {
          subscriptions.forEach(({ event, handler, capture }) => {
            document.addEventListener(event, handler, { capture });
          });

          ${beforeCleanup}

          return () => {
            subscriptions.forEach(({ event, handler, capture }) => {
              ${cleanup}
            });
          };
        }, [shouldCleanup, subscriptions]);

        return null;
      }
    `,
      { filename: "OutsideActions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts direct exhaustive emitter cleanup through projected listener tuples", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Subscriptions({ emitter, subscriptions }) {
        useEffect(() => {
          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          return () => {
            subscriptions.forEach(({ event, handler }) => {
              emitter.off(event, handler);
            });
          };
        }, [emitter, subscriptions]);

        return null;
      }
    `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "conditional cleanup",
      beforeCleanup: "",
      cleanup: "if (shouldCleanup) emitter.off(event, handler);",
    },
    {
      name: "post-registration collection mutation",
      beforeCleanup: "subscriptions.pop();",
      cleanup: "emitter.off(event, handler);",
    },
  ])("rejects projected emitter $name", ({ beforeCleanup, cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Subscriptions({ emitter, shouldCleanup, subscriptions }) {
        useEffect(() => {
          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          ${beforeCleanup}

          return () => {
            subscriptions.forEach(({ event, handler }) => {
              ${cleanup}
            });
          };
        }, [emitter, shouldCleanup, subscriptions]);

        return null;
      }
    `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects projected emitter cleanup wrapped in an unrelated collection", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Subscriptions({ emitter, subscriptions, unrelatedItems }) {
        useEffect(() => {
          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          return () => {
            unrelatedItems.forEach(() => {
              subscriptions.forEach(({ event, handler }) => {
                emitter.off(event, handler);
              });
            });
          };
        }, [emitter, subscriptions, unrelatedItems]);

        return null;
      }
    `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["subscriptions.pop();", "subscriptions.clear();"])(
    "rejects projected emitter cleanup after cleanup-body mutation with %s",
    (mutation) => {
      const result = runRule(
        effectNeedsCleanup,
        `
        function Subscriptions({ emitter, subscriptions }) {
          useEffect(() => {
            subscriptions.forEach(({ event, handler }) => {
              emitter.on(event, handler);
            });

            return () => {
              ${mutation}
              subscriptions.forEach(({ event, handler }) => {
                emitter.off(event, handler);
              });
            };
          }, [emitter, subscriptions]);

          return null;
        }
      `,
        { filename: "Subscriptions.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("rejects cleanup-body mutation when the cleanup is declared before registration", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Subscriptions({ emitter, subscriptions }) {
        useEffect(() => {
          function releaseSubscriptions() {
            subscriptions.pop();
            subscriptions.forEach(({ event, handler }) => {
              emitter.off(event, handler);
            });
          }

          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          return releaseSubscriptions;
        }, [emitter, subscriptions]);

        return null;
      }
    `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts exhaustive projected cleanup declared before registration", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Subscriptions({ emitter, subscriptions }) {
        useEffect(() => {
          function releaseSubscriptions() {
            subscriptions.forEach(({ event, handler }) => {
              emitter.off(event, handler);
            });
          }

          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          return releaseSubscriptions;
        }, [emitter, subscriptions]);

        return null;
      }
    `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts exhaustive projected cleanup returned through a stable alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Subscriptions({ emitter, subscriptions }) {
        useEffect(() => {
          const releaseSubscriptions = () => {
            subscriptions.forEach(({ event, handler }) => {
              emitter.off(event, handler);
            });
          };
          const cleanup = releaseSubscriptions;

          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          return cleanup;
        }, [emitter, subscriptions]);

        return null;
      }
    `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "subscriptions = [];",
    "subscriptions.length = 0;",
    "subscriptions[0] = subscriptions[1];",
    "delete subscriptions[0];",
  ])("rejects projected emitter cleanup after structural mutation with %s", (mutation) => {
    const result = runRule(
      effectNeedsCleanup,
      `
        function Subscriptions({ emitter, subscriptions }) {
          useEffect(() => {
            subscriptions.forEach(({ event, handler }) => {
              emitter.on(event, handler);
            });

            return () => {
              ${mutation}
              subscriptions.forEach(({ event, handler }) => {
                emitter.off(event, handler);
              });
            };
          }, [emitter, subscriptions]);

          return null;
        }
      `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "subscriptions.push({ event: 'extra', handler: extraHandler });",
    "subscriptions.unshift({ event: 'extra', handler: extraHandler });",
    "subscriptions.sort();",
    "subscriptions.reverse();",
    "subscriptions.add({ event: 'extra', handler: extraHandler });",
  ])(
    "accepts exhaustive projected cleanup after additive or order-only mutation with %s",
    (mutation) => {
      const result = runRule(
        effectNeedsCleanup,
        `
      function Subscriptions({ emitter, extraHandler, subscriptions }) {
        useEffect(() => {
          subscriptions.forEach(({ event, handler }) => {
            emitter.on(event, handler);
          });

          return () => {
            ${mutation}
            subscriptions.forEach(({ event, handler }) => {
              emitter.off(event, handler);
            });
          };
        }, [emitter, extraHandler, subscriptions]);

        return null;
      }
    `,
        { filename: "Subscriptions.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["emitter.off();", "emitter.dispose();"])(
    "accepts projected registrations followed by whole-receiver cleanup with %s",
    (cleanup) => {
      const result = runRule(
        effectNeedsCleanup,
        `
          function Subscriptions({ emitter, subscriptions }) {
            useEffect(() => {
              subscriptions.forEach(({ event, handler }) => {
                emitter.on(event, handler);
              });

              return () => {
                ${cleanup}
              };
            }, [emitter, subscriptions]);

            return null;
          }
        `,
        { filename: "Subscriptions.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("accepts projected handlers followed by handlerless event cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
        function Subscriptions({ emitter, handlers }) {
          useEffect(() => {
            handlers.forEach((handler) => {
              emitter.on("update", handler);
            });

            return () => {
              emitter.off("update");
            };
          }, [emitter, handlers]);

          return null;
        }
      `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'emitter.off("other");',
    'emitter.off("update", handlers[0]);',
    "emitter.off(getEvent());",
    "emitter.off(null);",
    'if (shouldCleanup) emitter.off("update");',
  ])("rejects projected handlers followed by incomplete event cleanup with %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `
          function Subscriptions({ emitter, handlers }) {
            useEffect(() => {
              handlers.forEach((handler) => {
                emitter.on("update", handler);
              });

              return () => {
                ${cleanup}
              };
            }, [emitter, handlers]);

            return null;
          }
        `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not mistake a unary addListener release for handlerless cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
        function Subscriptions({ source, handlers }) {
          useEffect(() => {
            handlers.forEach((handler) => {
              source.addListener(handler);
            });

            return () => {
              source.off(handlers[0]);
            };
          }, [handlers, source]);

          return null;
        }
      `,
      { filename: "Subscriptions.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["otherEmitter.off();", "otherEmitter.dispose();", 'emitter.off("focus");'])(
    "rejects projected registrations followed by incomplete whole-receiver cleanup with %s",
    (cleanup) => {
      const result = runRule(
        effectNeedsCleanup,
        `
          function Subscriptions({ emitter, otherEmitter, subscriptions }) {
            useEffect(() => {
              subscriptions.forEach(({ event, handler }) => {
                emitter.on(event, handler);
              });

              return () => {
                ${cleanup}
              };
            }, [emitter, otherEmitter, subscriptions]);

            return null;
          }
        `,
        { filename: "Subscriptions.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    {
      name: "a different receiver collection",
      cleanup:
        "cleanupRefs.forEach((elementRef) => elementRef.current?.removeEventListener(event, listener, capture));",
      extra: "const cleanupRefs = new Set(otherAnchorRefs);",
    },
    {
      name: "a different event projection",
      cleanup:
        "elementRefs.forEach((elementRef) => elementRef.current?.removeEventListener(cleanupEvent, listener, capture));",
      extra: "",
    },
    {
      name: "a different capture value",
      cleanup:
        "elementRefs.forEach((elementRef) => elementRef.current?.removeEventListener(event, listener, false));",
      extra: "",
    },
    {
      name: "a different handler projection",
      cleanup:
        "elementRefs.forEach((elementRef) => elementRef.current?.removeEventListener(event, cleanupListener, capture));",
      extra: "",
    },
    {
      name: "swapped event and handler projections",
      cleanup:
        "elementRefs.forEach((elementRef) => elementRef.current?.removeEventListener(listener, event, capture));",
      extra: "",
    },
    {
      name: "a conditional release",
      cleanup:
        "elementRefs.forEach((elementRef) => { if (shouldCleanup) elementRef.current?.removeEventListener(event, listener, capture); });",
      extra: "",
    },
  ])("rejects $name in nested listener collections", ({ cleanup, extra }) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs, otherAnchorRefs, shouldCleanup }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          ${extra}
          const enabledEvents = [
            {
              event: "focus",
              cleanupEvent: "blur",
              listener: handleFocus,
              cleanupListener: () => {},
              capture: true,
            },
          ];

          enabledEvents.forEach(({ event, listener, capture }) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(event, listener, capture);
            });
          });

          return () => {
            enabledEvents.forEach(({ event, cleanupEvent, listener, cleanupListener, capture }) => {
              ${cleanup}
            });
          };
        }, [anchorRefs, otherAnchorRefs, shouldCleanup]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a second callback parameter",
      setupParameters: "event, listener",
      setupEvent: "event.event",
      setupListener: "listener.listener",
      cleanupParameters: "event, listener",
      cleanupEvent: "event.event",
      cleanupListener: "listener.listener",
    },
    {
      name: "array destructuring",
      setupParameters: "[event, listener]",
      setupEvent: "event",
      setupListener: "listener",
      cleanupParameters: "[event, listener]",
      cleanupEvent: "event",
      cleanupListener: "listener",
    },
  ])("does not infer cleanup identity through $name", (fixture) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          const enabledEvents = [{ event: "focus", listener: handleFocus }];

          enabledEvents.forEach((${fixture.setupParameters}) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(${fixture.setupEvent}, ${fixture.setupListener});
            });
          });

          return () => {
            enabledEvents.forEach((${fixture.cleanupParameters}) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.removeEventListener(${fixture.cleanupEvent}, ${fixture.cleanupListener});
              });
            });
          };
        }, [anchorRefs]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts replay cleanup through matching defaulted object properties", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          const enabledEvents = [{ event: "focus", listener: handleFocus }];

          enabledEvents.forEach(({ event = "focus", listener = handleFocus, capture = false }) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(event, listener, capture);
            });
          });

          return () => {
            enabledEvents.forEach(({ event = "focus", listener = handleFocus, capture = false }) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.removeEventListener(event, listener, capture);
              });
            });
          };
        }, [anchorRefs]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects replay cleanup through different defaulted object properties", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          const enabledEvents = [{ event: "focus", listener: handleFocus }];

          enabledEvents.forEach(({ event, listener, capture = false }) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(event, listener, capture);
            });
          });

          return () => {
            enabledEvents.forEach(({ event, listener, capture = true }) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.removeEventListener(event, listener, capture);
              });
            });
          };
        }, [anchorRefs]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts replay cleanup through matching computed capture expressions", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          const enabledEvents = [{ event: "focus", listener: handleFocus }];

          enabledEvents.forEach(({ event, listener }) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(
                event,
                listener,
                event === "focus" || event === "blur",
              );
            });
          });

          return () => {
            enabledEvents.forEach(({ event, listener }) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.removeEventListener(
                  event,
                  listener,
                  event === "focus" || event === "blur",
                );
              });
            });
          };
        }, [anchorRefs]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects replay cleanup through different computed capture expressions", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      function Tooltip({ anchorRefs }) {
        const handleFocus = () => {};

        useEffect(() => {
          const elementRefs = new Set(anchorRefs);
          const enabledEvents = [{ event: "focus", listener: handleFocus }];

          enabledEvents.forEach(({ event, listener }) => {
            elementRefs.forEach((elementRef) => {
              elementRef.current?.addEventListener(
                event,
                listener,
                event === "focus" || event === "blur",
              );
            });
          });

          return () => {
            enabledEvents.forEach(({ event, listener }) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.removeEventListener(event, listener, event === "focus");
              });
            });
          };
        }, [anchorRefs]);

        return null;
      }
    `,
      { filename: "Tooltip.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["enabledEvents.pop();", "elementRefs.clear();"])(
    "rejects replay cleanup after the registered collection mutates with %s",
    (mutation) => {
      const result = runRule(
        effectNeedsCleanup,
        `
        function Tooltip({ anchorRefs }) {
          const handleFocus = () => {};

          useEffect(() => {
            const elementRefs = new Set(anchorRefs);
            const enabledEvents = [{ event: "focus", listener: handleFocus }];

            enabledEvents.forEach(({ event, listener }) => {
              elementRefs.forEach((elementRef) => {
                elementRef.current?.addEventListener(event, listener);
              });
            });

            ${mutation}

            return () => {
              enabledEvents.forEach(({ event, listener }) => {
                elementRefs.forEach((elementRef) => {
                  elementRef.current?.removeEventListener(event, listener);
                });
              });
            };
          }, [anchorRefs]);

          return null;
        }
      `,
        { filename: "Tooltip.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("rejects a legacy media listener cleanup with a changed handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const MediaQuery = ({ breakpoint }) => {
  useEffect(() => {
    const media = window.matchMedia(breakpoint);
    const handleMatch = () => update(media.matches);
    const otherHandler = () => update(false);
    media.addListener(handleMatch);
    return () => media.removeListener(otherHandler);
  }, [breakpoint]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a listener disposer assigned on only one control-flow path", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
declare const win: Window;
declare const updatePixelRatio: () => void;
export const Resolution = ({ shouldAssignCleanup }) => {
  useEffect(() => {
    let remove: (() => void) | null = null;
    const subscribe = () => {
      const media = win.matchMedia("(resolution: 1dppx)");
      media.addEventListener("change", updatePixelRatio);
      if (shouldAssignCleanup) {
        remove = () => media.removeEventListener("change", updatePixelRatio);
      }
    };
    subscribe();
    return () => remove?.();
  }, [shouldAssignCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an assigned disposer that releases another listener", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
declare const firstTarget: EventTarget;
declare const secondTarget: EventTarget;
declare const handler: EventListener;
export const Listener = () => {
  useEffect(() => {
    let remove: (() => void) | null = null;
    const subscribe = () => {
      firstTarget.addEventListener("change", handler);
      remove = () => secondTarget.removeEventListener("change", handler);
    };
    subscribe();
    return () => remove?.();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a returned function declaration that removes its listener", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
declare const emitter: {
  on: (eventName: string, handler: () => void) => void;
  off: (eventName: string, handler: () => void) => void;
};
declare const handler: () => void;
export const Emitter = () => {
  useEffect(() => {
    emitter.on("change", handler);
    function cleanup() {
      emitter.off("change", handler);
    }
    return cleanup;
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("effect-needs-cleanup inline useCallback reachability", () => {
  it("flags a socket leak in a useCallback wired directly to a JSX handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Feed = ({ url }) => (
  <button
    onClick={useCallback(() => {
      const socket = new WebSocket(url);
      socket.onmessage = update;
    }, [url])}
  >
    connect
  </button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("WebSocket");
  });

  it("flags a discarded timer through transparent JSX handler wrappers", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Poller = () => (
  <button
    onClick={(useCallback((() => setInterval(poll, 1000)) as () => number, []) satisfies () => number)}
  >
    poll
  </button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("ignores an unused inline useCallback value", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Feed = ({ url }) => {
  useCallback(() => {
    const socket = new WebSocket(url);
    socket.onmessage = update;
  }, [url]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores an inline useCallback passed to a non-handler prop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Feed = ({ url }) => (
  <Panel
    renderContent={useCallback(() => {
      const socket = new WebSocket(url);
      socket.onmessage = update;
    }, [url])}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not attribute a resource in a nested deferred callback to the JSX handler", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Feed = ({ url }) => (
  <button
    onClick={useCallback(() => {
      schedule(() => {
        const socket = new WebSocket(url);
        socket.onmessage = update;
      });
    }, [url])}
  >
    connect
  </button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an inline JSX useCallback that closes its socket", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const Feed = ({ url }) => (
  <button
    onClick={useCallback(() => {
      const socket = new WebSocket(url);
      socket.close();
    }, [url])}
  >
    connect
  </button>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("effect-needs-cleanup React ref callback reachability", () => {
  it("flags the pending timeout in the exact Victory ref callback shape", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const AnimatedValue = ({ data, delay, subscription }) => {
  const callbackRef = React.useRef(() => {});
  callbackRef.current = () => {
    setTimeout(() => subscription.subscribe(), delay);
  };
  React.useEffect(() => callbackRef.current(), [data]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it("accepts a timeout when the returned cleanup clears it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const AnimatedValue = ({ data, delay, task }) => {
  const callbackRef = React.useRef(() => () => {});
  callbackRef.current = () => {
    const timeout = setTimeout(task, delay);
    return () => clearTimeout(timeout);
  };
  React.useEffect(() => callbackRef.current(), [data]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat subscription cleanup as cleanup for the pending timeout", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const AnimatedValue = ({ data, delay, subscription }) => {
  const callbackRef = React.useRef(() => () => {});
  callbackRef.current = () => {
    setTimeout(() => subscription.subscribe(), delay);
    const unsubscribe = subscription.subscribe();
    return () => unsubscribe();
  };
  React.useEffect(() => callbackRef.current(), [data]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it("matches the existing named-helper verdict for a direct subscription", () => {
    const refResult = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const AnimatedValue = ({ data, subscription }) => {
  const callbackRef = React.useRef(() => {});
  callbackRef.current = () => {
    subscription.subscribe();
  };
  React.useEffect(() => callbackRef.current(), [data]);
  return null;
};`,
    );
    const namedResult = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const AnimatedValue = ({ data, subscription }) => {
  const runAnimation = () => {
    subscription.subscribe();
  };
  React.useEffect(() => runAnimation(), [data]);
  return null;
};`,
    );
    expect(refResult.parseErrors).toEqual([]);
    expect(namedResult.parseErrors).toEqual([]);
    expect(refResult.diagnostics).toHaveLength(1);
    expect(namedResult.diagnostics).toHaveLength(1);
    expect(refResult.diagnostics[0].message).toContain("subscribe");
    expect(namedResult.diagnostics[0].message).toContain("subscribe");
  });

  it("accepts a React ref callback whose effect owns the returned disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const LiveValue = ({ data, subscription }) => {
  const callbackRef = React.useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    return () => unsubscribe();
  };
  React.useEffect(() => callbackRef.current(), [data]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a React ref callback that returns a bound disposer to its effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LiveValue = ({ subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    return unsubscribe;
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when a React ref callback returns a different bound disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LiveValue = ({ subscription, otherSubscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    subscription.subscribe();
    const unsubscribeOther = otherSubscription.subscribe();
    return unsubscribeOther;
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a bound disposer does not escape on every callback path", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LiveValue = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    if (enabled) return unsubscribe;
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts ref callback results returned through logical effect expressions", () => {
    for (const operator of ["&&", "||"]) {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect, useRef } from "react";
export const LiveValue = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => enabled ${operator} callbackRef.current(), [enabled]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("ignores an uncalled React ref callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const UnusedValue = ({ subscription }) => {
  const callbackRef = React.useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows const aliases, static computed current, and optional effect calls", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LiveValue = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  const callbackAlias = callbackRef;
  callbackAlias["current"] = () => {
    subscription.subscribe();
  };
  useEffect(() => callbackAlias.current?.(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("subscribe");
  });

  it("keeps one-shot event-handler invocation outside the direct-effect v1 scope", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useRef } from "react";
export const ConnectButton = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => {
    setTimeout(() => subscription.subscribe(), 100);
  };
  const onClick = () => callbackRef.current();
  return <button onClick={onClick}>Connect</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores ordinary current objects and userland useRef functions", () => {
    const sources = [
      `import { useEffect } from "react";
export const OrdinaryObject = ({ subscription }) => {
  const callbackRef = { current: () => {} };
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
      `import { useEffect } from "react";
const useRef = (initialValue) => ({ current: initialValue });
export const ShadowedRef = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
      `import { useEffect } from "react";
import { useRef } from "./state";
export const UserlandRef = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("ignores dynamic current access and reassigned aliases", () => {
    const sources = [
      `import { useEffect, useRef } from "react";
export const DynamicProperty = ({ propertyName, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef[propertyName] = () => subscription.subscribe();
  useEffect(() => callbackRef[propertyName](), [propertyName]);
  return null;
};`,
      `import { useEffect, useRef } from "react";
export const ReassignedAlias = ({ otherRef, subscription }) => {
  const callbackRef = useRef(() => {});
  let callbackAlias = callbackRef;
  callbackAlias = otherRef;
  callbackAlias.current = () => subscription.subscribe();
  useEffect(() => callbackAlias.current(), []);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("ignores a leaking assignment overwritten before the effect call", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LatestCallback = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  callbackRef.current = () => {};
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a leaking assignment overwritten inside the invoking effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LatestCallback = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    callbackRef.current = () => {};
    callbackRef.current();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires effect-local overwrites on every path before invocation", () => {
    const partialOverwriteResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PartialOverwrite = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    if (enabled) callbackRef.current = () => {};
    callbackRef.current();
  }, [enabled]);
  return null;
};`,
    );
    const completeOverwriteResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const CompleteOverwrite = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    if (enabled) {
      callbackRef.current = () => {};
    } else {
      callbackRef.current = () => {};
    }
    callbackRef.current();
  }, [enabled]);
  return null;
};`,
    );
    expect(partialOverwriteResult.parseErrors).toEqual([]);
    expect(completeOverwriteResult.parseErrors).toEqual([]);
    expect(partialOverwriteResult.diagnostics).toHaveLength(1);
    expect(completeOverwriteResult.diagnostics).toHaveLength(0);
  });

  it("still reports cleanup work after the selected callback reassigns its own ref", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const LatestCallback = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => {
    callbackRef.current = () => {};
    subscription.subscribe();
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores conditional competing assignments", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const ConditionalCallback = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  if (enabled) {
    callbackRef.current = () => subscription.subscribe();
  } else {
    callbackRef.current = () => {};
  }
  useEffect(() => callbackRef.current(), [enabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a reachable ref call from a real React effect", () => {
    const sources = [
      `import { useEffect, useRef } from "react";
export const DeadCall = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    if (false) callbackRef.current();
  }, []);
  return null;
};`,
      `import { useRef } from "react";
const useEffect = (callback) => callback;
export const FakeEffect = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("abstains when effect ownership crosses a local helper", () => {
    const sources = [
      `import { useEffect, useRef } from "react";
export const ReturnedHelper = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  const run = () => callbackRef.current();
  useEffect(() => run(), []);
  return null;
};`,
      `import { useEffect, useRef } from "react";
export const DiscardedHelper = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  const run = () => callbackRef.current();
  useEffect(() => {
    run();
  }, []);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("keeps generator, identifier, and conditional right-hand sides outside v1 scope", () => {
    const sources = [
      `import { useEffect, useRef } from "react";
export const GeneratorCallback = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = function* () {
    subscription.subscribe();
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
      `import { useEffect, useRef } from "react";
const subscribeLater = (subscription) => subscription.subscribe();
export const IdentifierCallback = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = subscribeLater;
  useEffect(() => callbackRef.current(subscription), [subscription]);
  return null;
};`,
      `import { useEffect, useRef } from "react";
export const ConditionalCallback = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = enabled
    ? () => subscription.subscribe()
    : () => {};
  useEffect(() => callbackRef.current(), [enabled]);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("reports a direct disposer when the effect discards it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DiscardedDisposer = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    callbackRef.current();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a bound disposer when the effect discards it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DiscardedDisposer = ({ subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    return unsubscribe;
  };
  useEffect(() => {
    callbackRef.current();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a block-returned disposer from an async ref callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const AsyncDisposer = ({ subscription }) => {
  const callbackRef = useRef(async () => {});
  callbackRef.current = async () => {
    return subscription.subscribe();
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a socket returned from a ref callback regardless of effect ownership", () => {
    const effectCallbacks = [
      `() => callbackRef.current()`,
      `() => {
        callbackRef.current();
      }`,
    ];
    for (const effectCallback of effectCallbacks) {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect, useRef } from "react";
export const LiveSocket = ({ url }) => {
  const callbackRef = useRef(() => null);
  callbackRef.current = () => {
    return new WebSocket(url);
  };
  useEffect(${effectCallback}, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("accepts a direct disposer returned by the effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const OwnedDisposer = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a ref callback result returned through an effect binding", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const OwnedDisposer = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    const cleanup = callbackRef.current();
    return cleanup;
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a ref callback result conditionally returned through an effect binding", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PartialDisposer = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    const cleanup = callbackRef.current();
    if (enabled) return cleanup;
  }, [enabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a disposer returned from one branch of an effect conditional", () => {
    const effectExpressions = [
      `enabled ? callbackRef.current() : undefined`,
      `enabled ? undefined : callbackRef.current()`,
      `enabled ? callbackRef.current() : noop()`,
      `outer ? (enabled ? callbackRef.current() : undefined) : undefined`,
    ];
    for (const effectExpression of effectExpressions) {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect, useRef } from "react";
export const ConditionalOwner = ({ enabled, outer, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => ${effectExpression}, [enabled, outer]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not treat a Boolean-wrapped disposer as effect cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const WrappedDisposer = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => Boolean(callbackRef.current()), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("owns only a final sequence-expression result", () => {
    const ownedResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const OwnedSequence = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => (track(), callbackRef.current()), []);
  return null;
};`,
    );
    const discardedResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DiscardedSequence = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => (callbackRef.current(), track()), []);
  return null;
};`,
    );
    expect(ownedResult.parseErrors).toEqual([]);
    expect(discardedResult.parseErrors).toEqual([]);
    expect(ownedResult.diagnostics).toHaveLength(0);
    expect(discardedResult.diagnostics).toHaveLength(1);
  });

  it("reports a conditionally returned nested cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PartialCleanup = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    return enabled ? () => unsubscribe() : undefined;
  };
  useEffect(() => callbackRef.current(), [enabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("gates a named cleanup alias on effect ownership", () => {
    const discardedResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DiscardedAlias = ({ subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    const cleanup = () => unsubscribe();
    return cleanup;
  };
  useEffect(() => {
    callbackRef.current();
  }, []);
  return null;
};`,
    );
    const ownedResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const OwnedAlias = ({ subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    const cleanup = () => unsubscribe();
    return cleanup;
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    expect(discardedResult.parseErrors).toEqual([]);
    expect(ownedResult.parseErrors).toEqual([]);
    expect(discardedResult.diagnostics).toHaveLength(1);
    expect(ownedResult.diagnostics).toHaveLength(0);
  });

  it("gates wrapped and transitively aliased cleanups on effect ownership", () => {
    const cleanupShapes = [
      {
        aliasDeclaration: "",
        returnExpression: "() => cleanup()",
      },
      {
        aliasDeclaration: "const cleanupAlias = cleanup;",
        returnExpression: "cleanupAlias",
      },
    ];
    for (const cleanupShape of cleanupShapes) {
      const source = (effectCallback: string): string => `import { useEffect, useRef } from "react";
export const CleanupOwner = ({ subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    const cleanup = () => unsubscribe();
    ${cleanupShape.aliasDeclaration}
    return ${cleanupShape.returnExpression};
  };
  useEffect(${effectCallback}, []);
  return null;
};`;
      const ownedResult = runRule(effectNeedsCleanup, source("() => callbackRef.current()"));
      const discardedResult = runRule(
        effectNeedsCleanup,
        source(`() => {
          callbackRef.current();
        }`),
      );
      expect(ownedResult.parseErrors).toEqual([]);
      expect(discardedResult.parseErrors).toEqual([]);
      expect(ownedResult.diagnostics).toHaveLength(0);
      expect(discardedResult.diagnostics).toHaveLength(1);
    }
  });

  it("accepts bound disposers returned as final sequence values", () => {
    const callbackBindingResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const CallbackBinding = ({ subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const cleanup = subscription.subscribe();
    return (track(), cleanup);
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    );
    const effectBindingResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const EffectBinding = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    const cleanup = callbackRef.current();
    return (track(), cleanup);
  }, []);
  return null;
};`,
    );
    expect(callbackBindingResult.parseErrors).toEqual([]);
    expect(effectBindingResult.parseErrors).toEqual([]);
    expect(callbackBindingResult.diagnostics).toHaveLength(0);
    expect(effectBindingResult.diagnostics).toHaveLength(0);
  });

  it("reports bound effect disposers behind partial expression returns", () => {
    for (const returnExpression of ["enabled && cleanup", "enabled ? cleanup : undefined"]) {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect, useRef } from "react";
export const PartialCleanup = ({ enabled, subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => {
    const cleanup = callbackRef.current();
    return ${returnExpression};
  }, [enabled]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("accepts a cleanup helper invoked on every path after acquisition", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const SynchronousCleanup = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => {
    const unsubscribe = subscription.subscribe();
    const cleanup = () => unsubscribe();
    cleanup();
  };
  useEffect(() => {
    callbackRef.current();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when one effect owns the disposer but another discards it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const MixedOwnership = ({ subscription }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  useEffect(() => {
    callbackRef.current();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a non-callable observe result returned through the effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const ObservedValue = ({ element, observer }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => observer.observe(element);
  useEffect(() => callbackRef.current(), [element]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("observe");
  });

  it("preserves an observe result returned to an ordinary caller", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const ObserveButton = ({ element, observer }) => {
  const attach = useCallback(() => observer.observe(element), [element, observer]);
  return <button onClick={() => attach()}>Observe</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports resources acquired by async ref callbacks", () => {
    const sources = [
      `import { useEffect, useRef } from "react";
export const AsyncDisposer = ({ subscription }) => {
  const callbackRef = useRef(async () => {});
  callbackRef.current = async () => subscription.subscribe();
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
      `import { useEffect, useRef } from "react";
export const AsyncNestedCleanup = ({ subscription }) => {
  const callbackRef = useRef(async () => {});
  callbackRef.current = async () => {
    const unsubscribe = subscription.subscribe();
    return () => unsubscribe();
  };
  useEffect(() => callbackRef.current(), []);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("reports partial cleanup that leaves an interval alive", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PartialCleanup = ({ poll, subscription }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    setInterval(poll, 1000);
    const unsubscribe = subscription.subscribe();
    return () => unsubscribe();
  };
  useEffect(() => callbackRef.current(), [poll]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("flags an invoked ref callback that starts an uncleared interval", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PollingValue = ({ poll }) => {
  const callbackRef = useRef(() => {});
  callbackRef.current = () => setInterval(poll, 1000);
  useEffect(() => callbackRef.current(), [poll]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("accepts an invoked ref callback whose returned cleanup clears its interval", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PollingValue = ({ poll }) => {
  const callbackRef = useRef(() => () => {});
  callbackRef.current = () => {
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  };
  useEffect(() => callbackRef.current(), [poll]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("effect-needs-cleanup React ref callback chains", () => {
  it("flags the pending timeout in the authentic two-hop Victory oracle chain", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const VictoryAnimation = ({ delay, duration, timer }) => {
  const queue = React.useRef([{}]);
  const loopID = React.useRef();
  const runFrameRef = React.useRef(() => {});
  const traverseQueueRef = React.useRef(() => {});
  const startRef = React.useRef(() => {});
  traverseQueueRef.current = () => {
    if (queue.current.length && delay) {
      setTimeout(() => {
        loopID.current = timer.subscribe(
          (elapsed) => runFrameRef.current(elapsed),
          duration,
        );
      }, delay);
    }
  };
  startRef.current = () => {
    if (queue.current.length) {
      traverseQueueRef.current();
    }
  };
  React.useEffect(() => {
    startRef.current();
    return () => timer.unsubscribe(loopID.current);
  }, []);
  return null;
};`,
      { filename: "packages/victory-core/src/victory-animation/victory-animation.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });

  it("follows three synchronous React ref callback hops", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const ChainedSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => {});
  const prepareRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  prepareRef.current = () => subscribeRef.current();
  startRef.current = () => prepareRef.current();
  useEffect(() => {
    startRef.current();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("subscribe");
  });

  it("accepts cleanup ownership returned through every ref callback hop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const OwnedSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => () => {});
  const startRef = useRef(() => () => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => subscribeRef.current();
  useEffect(() => startRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when an intermediate ref callback discards cleanup ownership", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const DiscardedSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => () => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => {
    subscribeRef.current();
  };
  useEffect(() => startRef.current(), []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires intermediate overwrites on every path before invocation", () => {
    const partialOverwriteResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const PartialOverwrite = ({ enabled, subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => {
    if (enabled) subscribeRef.current = () => {};
    subscribeRef.current();
  };
  useEffect(() => startRef.current(), [enabled]);
  return null;
};`,
    );
    const completeOverwriteResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const CompleteOverwrite = ({ enabled, subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => {
    if (enabled) {
      subscribeRef.current = () => {};
    } else {
      subscribeRef.current = () => {};
    }
    subscribeRef.current();
  };
  useEffect(() => startRef.current(), [enabled]);
  return null;
};`,
    );
    expect(partialOverwriteResult.parseErrors).toEqual([]);
    expect(completeOverwriteResult.parseErrors).toEqual([]);
    expect(partialOverwriteResult.diagnostics).toHaveLength(1);
    expect(completeOverwriteResult.diagnostics).toHaveLength(0);
  });

  it("reports a leaking conditional ref definition and accepts all-owned definitions", () => {
    const leakingDefinitionResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const ConditionalSubscription = ({ enabled, subscription }) => {
  const subscribeRef = useRef(() => () => {});
  const startRef = useRef(() => () => {});
  if (enabled) {
    subscribeRef.current = () => subscription.subscribe();
  } else {
    subscribeRef.current = () => {
      subscription.subscribe();
    };
  }
  startRef.current = () => subscribeRef.current();
  useEffect(() => startRef.current(), [enabled, subscription]);
  return null;
};`,
    );
    const ownedDefinitionsResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const ConditionalSubscription = ({ enabled, primary, secondary }) => {
  const subscribeRef = useRef(() => () => {});
  const startRef = useRef(() => () => {});
  if (enabled) {
    subscribeRef.current = () => primary.subscribe();
  } else {
    subscribeRef.current = () => secondary.subscribe();
  }
  startRef.current = () => subscribeRef.current();
  useEffect(() => startRef.current(), [enabled, primary, secondary]);
  return null;
};`,
    );
    expect(leakingDefinitionResult.parseErrors).toEqual([]);
    expect(ownedDefinitionsResult.parseErrors).toEqual([]);
    expect(leakingDefinitionResult.diagnostics).toHaveLength(1);
    expect(ownedDefinitionsResult.diagnostics).toHaveLength(0);
  });

  it("uses only the last unconditional sequential ref definition", () => {
    const overwrittenLeakResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const OverwrittenSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => {
    subscription.subscribe();
  };
  subscribeRef.current = () => {};
  startRef.current = () => subscribeRef.current();
  useEffect(() => startRef.current(), [subscription]);
  return null;
};`,
    );
    const finalLeakResult = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const FinalSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => {};
  subscribeRef.current = () => {
    subscription.subscribe();
  };
  startRef.current = () => subscribeRef.current();
  useEffect(() => startRef.current(), [subscription]);
  return null;
};`,
    );
    expect(overwrittenLeakResult.parseErrors).toEqual([]);
    expect(finalLeakResult.parseErrors).toEqual([]);
    expect(overwrittenLeakResult.diagnostics).toHaveLength(0);
    expect(finalLeakResult.diagnostics).toHaveLength(1);
  });

  it("handles many effect-reachable ref callbacks in one component", () => {
    const callbackCount = 64;
    const refDeclarations = Array.from(
      { length: callbackCount },
      (_, index) => `const callbackRef${index} = useRef(() => {});`,
    ).join("\n");
    const callbackAssignments = Array.from(
      { length: callbackCount },
      (_, index) => `callbackRef${index}.current = () => { setTimeout(onTick, ${index}); };`,
    ).join("\n");
    const callbackCalls = Array.from(
      { length: callbackCount },
      (_, index) => `callbackRef${index}.current();`,
    ).join("\n");
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect, useRef } from "react";
export const ManyCallbacks = ({ onTick }) => {
  ${refDeclarations}
  ${callbackAssignments}
  useEffect(() => {
    ${callbackCalls}
  }, [onTick]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(callbackCount);
  });

  it("ignores ref callback chains invoked only by deferred work or events", () => {
    const sources = [
      `import { useEffect, useRef } from "react";
export const DeferredSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => subscribeRef.current();
  useEffect(() => {
    const timeout = setTimeout(() => startRef.current(), 100);
    return () => clearTimeout(timeout);
  }, []);
  return null;
};`,
      `import { useRef } from "react";
export const EventSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => subscribeRef.current();
  return <button onClick={() => startRef.current()}>start</button>;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("ignores unseeded cycles and shadowed ref chains", () => {
    const sources = [
      `import { useRef } from "react";
export const CyclicSubscription = ({ subscription }) => {
  const firstRef = useRef(() => {});
  const secondRef = useRef(() => {});
  firstRef.current = () => {
    subscription.subscribe();
    secondRef.current();
  };
  secondRef.current = () => firstRef.current();
  return null;
};`,
      `const useRef = (initialValue) => ({ current: initialValue });
const useEffect = (callback) => callback();
export const UserlandSubscription = ({ subscription }) => {
  const subscribeRef = useRef(() => {});
  const startRef = useRef(() => {});
  subscribeRef.current = () => subscription.subscribe();
  startRef.current = () => subscribeRef.current();
  useEffect(() => startRef.current(), []);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });
});

describe("effect-needs-cleanup useSyncExternalStore subscription cleanup", () => {
  it("accepts a conditionally delegated subscription disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
export const AccordionItem = ({ root, itemKey }) => {
  const subscribe = useCallback(
    (onStoreChange) => (root ? root.subscribe(itemKey, onStoreChange) : () => {}),
    [root, itemKey],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an optional subscription with a nullish no-op fallback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
export const AccordionItem = ({ sharedContext }) => {
  const subscribe = useCallback(
    (listener) => sharedContext?.subscribe(listener) ?? (() => {}),
    [sharedContext],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a conditional wrapper that discards the delegated disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
export const AccordionItem = ({ root, itemKey }) => {
  const subscribe = useCallback(
    (onStoreChange) =>
      root ? (root.subscribe(itemKey, onStoreChange), () => {}) : () => {},
    [root, itemKey],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a logical-and wrapper that replaces the delegated disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
export const StoreValue = ({ store }) => {
  const subscribe = useCallback(
    () => store.subscribe(update) && (() => {}),
    [store],
  );
  return useSyncExternalStore(subscribe, store.getSnapshot);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts the TaskTrove i18next subscription with its matching returned disposer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
import i18next from "i18next";
export const LanguageProvider = () => {
  const subscribeToLanguage = useCallback((onStoreChange: () => void) => {
    i18next.on("languageChanged", onStoreChange);
    return () => {
      i18next.off("languageChanged", onStoreChange);
    };
  }, []);
  const language = useSyncExternalStore(
    subscribeToLanguage,
    () => i18next.resolvedLanguage,
    () => "en",
  );
  return language;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "receiver",
      cleanup: `otherI18next.off("languageChanged", onStoreChange);`,
    },
    {
      name: "event",
      cleanup: `i18next.off("loaded", onStoreChange);`,
    },
    {
      name: "handler",
      cleanup: `i18next.off("languageChanged", otherHandler);`,
    },
  ])("rejects a returned disposer with the wrong $name", ({ cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
export const LanguageProvider = ({ i18next, otherI18next, otherHandler }) => {
  const subscribeToLanguage = useCallback((onStoreChange) => {
    i18next.on("languageChanged", onStoreChange);
    return () => {
      ${cleanup}
    };
  }, [i18next, otherI18next, otherHandler]);
  useSyncExternalStore(subscribeToLanguage, getSnapshot);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects cleanup returned on only one path after subscribing", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore } from "react";
export const LanguageProvider = ({ i18next, shouldCleanup }) => {
  const subscribeToLanguage = useCallback((onStoreChange) => {
    i18next.on("languageChanged", onStoreChange);
    if (shouldCleanup) {
      return () => i18next.off("languageChanged", onStoreChange);
    }
    return undefined;
  }, [i18next, shouldCleanup]);
  useSyncExternalStore(subscribeToLanguage, getSnapshot);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts matching receiver, event, and handler aliases", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useSyncExternalStore as useStore } from "react";
export const LanguageProvider = ({ i18next }) => {
  const subscribeToLanguage = useCallback((onStoreChange) => {
    const emitter = i18next;
    const eventName = "languageChanged";
    const handler = onStoreChange;
    emitter.on(eventName, handler);
    return () => emitter.off(eventName, handler);
  }, [i18next]);
  const subscribe = subscribeToLanguage;
  useStore(subscribe, getSnapshot);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a shadowed useSyncExternalStore call as a cleanup contract", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from "react";
export const LanguageProvider = ({ i18next }) => {
  const useSyncExternalStore = (subscribe) => subscribe;
  const subscribeToLanguage = useCallback((onStoreChange) => {
    i18next.on("languageChanged", onStoreChange);
    return () => i18next.off("languageChanged", onStoreChange);
  }, [i18next]);
  useSyncExternalStore(subscribeToLanguage);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("effect-needs-cleanup Promise callback timers (issue #1241)", () => {
  it("flags a timer in an unguarded Promise callback with conditional cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timeoutId;
    Promise.resolve().then(() => {
      timeoutId = setTimeout(() => console.log('fired'), 1000);
    });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("without guaranteed cleanup");
  });

  it("flags a timer in an unguarded Promise callback with unconditional cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timeoutId;
    Promise.resolve().then(() => {
      timeoutId = setTimeout(() => console.log('fired'), 1000);
    });
    return () => clearTimeout(timeoutId);
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a timer in Promise callback with active flag guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ syncReminder }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    void syncReminder().then((result) => {
      if (!isActive || result !== 'permission-pending') return;
      timeoutId = setTimeout(() => {
        if (isActive) console.log('tick');
      }, 5000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [syncReminder]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a timer in .then() callback with TypeScript type annotation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let isActive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    Promise.resolve().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(() => console.log('fired'), 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cancelled timer in a .catch() callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall }) => {
  useEffect(() => {
    let didCancel = false;
    let timeoutId;
    asyncCall().catch(() => {
      if (didCancel) return;
      timeoutId = setTimeout(() => console.log('error recovery'), 3000);
    });
    return () => {
      didCancel = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a timer inside an active branch in a .finally() callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    asyncCall().finally(() => {
      if (isActive) {
        timeoutId = setTimeout(() => console.log('cleanup'), 1000);
      }
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a timer in Promise callback without any cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    Promise.resolve().then(() => {
      setTimeout(() => console.log('leaked'), 1000);
    });
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a timer in Promise callback with cleanup for different handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timeoutId;
    let otherTimeoutId;
    Promise.resolve().then(() => {
      timeoutId = setTimeout(() => console.log('leaked'), 1000);
    });
    return () => clearTimeout(otherTimeoutId);
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async Promise callback when the guard is not rechecked after await", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    asyncCall().then(async () => {
      if (!isActive) return;
      await Promise.resolve();
      timeoutId = setTimeout(() => console.log('late'), 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a Promise callback when cleanup invalidates its guard conditionally", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall, shouldCancel }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    asyncCall().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(() => console.log('late'), 1000);
    });
    return () => {
      if (shouldCancel) isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall, shouldCancel]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a Promise callback when async cleanup defers guard invalidation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    asyncCall().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(() => console.log('late'), 1000);
    });
    return async () => {
      await Promise.resolve();
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a Promise callback that overwrites its guard before scheduling a timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    asyncCall().then(() => {
      isActive = true;
      if (!isActive) return;
      timeoutId = setTimeout(() => console.log('late'), 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not require cleanup on an early-return path before the Promise chain", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ asyncCall, disabled }) => {
  useEffect(() => {
    if (disabled) return;
    let isActive = true;
    let timeoutId;
    asyncCall().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(() => console.log('late'), 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [asyncCall, disabled]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags repeated timer assignments to one handle in a Promise callback", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(firstTask, 1000);
      timeoutId = setTimeout(secondTask, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags competing Promise callbacks that assign the same timer handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ firstLoad, secondLoad }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    firstLoad().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(firstTask, 1000);
    });
    secondLoad().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(secondTask, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [firstLoad, secondLoad]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded timer assignment that can repeat in a loop", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, tasks }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      for (const task of tasks) {
        timeoutId = setTimeout(task, 1000);
      }
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, tasks]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a synchronous call that can unmount after the lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, runBeforeSchedule }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      runBeforeSchedule();
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, runBeforeSchedule]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a synchronous call before the lifecycle guard is rechecked", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, prepare }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      prepare();
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, prepare]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a call confined to the inactive early-return branch", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) {
        logInactive();
        return;
      }
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a nested call confined to the inactive early-return branch", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ debug, load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) {
        if (debug) logInactive();
        return;
      }
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [debug, load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a call confined to an inactive throwing branch", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, makeInactiveError }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) {
        throw makeInactiveError();
      }
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, makeInactiveError]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a conditional call on a path that rejoins before timer allocation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, prepare, shouldPrepare }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      if (shouldPrepare) prepare();
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, prepare, shouldPrepare]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a call in the active else branch before timer allocation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, prepare }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) {
        return;
      } else {
        prepare();
      }
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, prepare]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps opaque logical-expression calls conservative", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, prepare, shouldPrepare }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      shouldPrepare && prepare();
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, prepare, shouldPrepare]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores an unreachable call after the inactive branch returns", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, unreachableCall }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) {
        return;
        unreachableCall();
      }
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, unreachableCall]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a partially terminating inactive branch", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ debug, load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) {
        if (debug) return;
        logInactive();
      }
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [debug, load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inactive branch whose explicit throw is caught before allocation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      try {
        if (!isActive) {
          logInactive();
          throw new Error("inactive");
        }
      } catch {}
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inactive call that can throw through a catch before allocation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      try {
        if (!isActive) {
          logInactive();
          return;
        }
      } catch {}
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a potentially interrupting call in the lifecycle guard test", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, prepare }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive || prepare()) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, prepare]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a terminal call subpath inside a positive lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ debug, load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (isActive) {
        if (debug) {
          logInactive();
          return;
        }
        timeoutId = setTimeout(task, 1000);
      }
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [debug, load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a rejoining call branch inside a positive lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ debug, load, logInactive }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (isActive) {
        if (debug) logInactive();
        timeoutId = setTimeout(task, 1000);
      }
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [debug, load, logInactive]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept guarded timer allocation inside a loop with continue", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, logInactive, tasks }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      for (const task of tasks) {
        if (!isActive) {
          logInactive();
          continue;
        }
        timeoutId = setTimeout(task, 1000);
        break;
      }
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, logInactive, tasks]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a timer argument that can unmount after the lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ getDelay, load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, getDelay());
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [getDelay, load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded Promise timer stored outside the effect instance", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
let sharedTimeoutId;
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    load().then(() => {
      if (!isActive) return;
      sharedTimeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(sharedTimeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded Promise timer controlled by shared lifecycle state", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
let isActive = true;
export const Component = ({ load }) => {
  useEffect(() => {
    isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a lifecycle guard that another callback can reactivate", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, reactivate }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    reactivate(() => {
      isActive = true;
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, reactivate]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not apply the guarded timer proof to a shadowed allocator", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, setTimeout }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load, setTimeout]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not apply the guarded timer proof to a shadowed release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ clearTimeout, load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [clearTimeout, load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags cleanup that releases the timer only under an unrelated condition", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, shouldRelease }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      if (shouldRelease) clearTimeout(timeoutId);
    };
  }, [load, shouldRelease]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a generator cleanup whose body React never executes", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return function* cleanup() {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts cleanup guarded by the owned timer handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    { name: "loose null", guard: "timeoutId != null" },
    { name: "reversed loose null", guard: "null != timeoutId" },
    { name: "loose undefined", guard: "timeoutId != undefined" },
    { name: "reversed loose undefined", guard: "undefined != timeoutId" },
    { name: "strict undefined", guard: "timeoutId !== undefined" },
    { name: "reversed strict undefined", guard: "undefined !== timeoutId" },
    { name: "strict null", guard: "timeoutId !== null" },
    { name: "reversed strict null", guard: "null !== timeoutId" },
  ])("accepts cleanup guarded by the owned timer handle with $name", ({ guard }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      if (${guard}) clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "loose null equality",
      parameters: "{ load }",
      declaration: "",
      guard: "timeoutId == null",
    },
    {
      name: "reversed strict equality",
      parameters: "{ load }",
      declaration: "",
      guard: "undefined === timeoutId",
    },
    {
      name: "another timer handle",
      parameters: "{ load }",
      declaration: "let otherTimeoutId;",
      guard: "otherTimeoutId != null",
    },
    {
      name: "a shadowed undefined value",
      parameters: "{ load, undefined }",
      declaration: "",
      guard: "timeoutId !== undefined",
    },
  ])("rejects cleanup guarded by $name", ({ parameters, declaration, guard }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = (${parameters}) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    ${declaration}
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      if (${guard}) clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "truthy release then target reset",
      declaration: "",
      cleanup: "if (timeoutId) clearTimeout(timeoutId); timeoutId = null;",
    },
    {
      name: "nullish release then target reset",
      declaration: "",
      cleanup: "if (timeoutId !== undefined) clearTimeout(timeoutId); timeoutId = undefined;",
    },
    {
      name: "release and reset inside the owned-handle branch",
      declaration: "",
      cleanup: "if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }",
    },
    {
      name: "owned-handle release then unrelated reset",
      declaration: "let otherTimeoutId;",
      cleanup: "if (timeoutId) clearTimeout(timeoutId); otherTimeoutId = null;",
    },
  ])("accepts guarded cleanup with $name", ({ declaration, cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    ${declaration}
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      ${cleanup}
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an early return after a guarded release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, shouldStopCleanup }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        if (shouldStopCleanup) return;
      }
    };
  }, [load, shouldStopCleanup]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "an early return before release",
      cleanup: "if (timeoutId) { if (shouldSkipRelease) return; clearTimeout(timeoutId); }",
    },
    {
      name: "a target reset before release in the owned-handle branch",
      cleanup: "if (timeoutId) { timeoutId = null; clearTimeout(timeoutId); }",
    },
    {
      name: "a conditional target reset before release",
      cleanup:
        "if (timeoutId) { if (shouldSkipRelease) timeoutId = null; clearTimeout(timeoutId); }",
    },
    {
      name: "a conditionally skipped release inside the owned-handle branch",
      cleanup: "if (timeoutId) { if (shouldSkipRelease) return; else clearTimeout(timeoutId); }",
    },
  ])("rejects an owned-handle guard with $name", ({ cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, shouldSkipRelease }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      ${cleanup}
    };
  }, [load, shouldSkipRelease]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "target reset before guarded release",
      declaration: "",
      cleanup: "timeoutId = null; if (timeoutId) clearTimeout(timeoutId);",
    },
    {
      name: "release nested under an unrelated branch",
      declaration: "",
      cleanup: "if (shouldRelease) { if (timeoutId) clearTimeout(timeoutId); } timeoutId = null;",
    },
    {
      name: "release guarded by another handle",
      declaration: "let otherTimeoutId;",
      cleanup: "if (otherTimeoutId) clearTimeout(timeoutId); timeoutId = null;",
    },
  ])("rejects guarded cleanup with $name", ({ declaration, cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load, shouldRelease }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    ${declaration}
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      ${cleanup}
    };
  }, [load, shouldRelease]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts clearing and resetting the timer handle during cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      timeoutId = undefined;
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags resetting the timer handle before cleanup releases it", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Component = ({ load }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId;
    load().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(task, 1000);
    });
    return () => {
      isActive = false;
      timeoutId = undefined;
      clearTimeout(timeoutId);
    };
  }, [load]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts listener replacement owned by a JSX callback ref", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) {
      previous.removeEventListener("wheel", onWheel);
    }
    viewportNodeRef.current = node;
    if (node) {
      node.addEventListener("wheel", onWheel, { passive: false });
    }
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an unreassigned let alias for the previous callback-ref node", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    let previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an unreassigned alias for the callback-ref node", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    const currentNode = node;
    const previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = currentNode;
    if (currentNode) currentNode.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts listener replacement exposed as a hook ref property", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const useViewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const attachViewportListeners = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return { viewportRef: attachViewportListeners };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts listener replacement exposed as a bare hook ref property", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const useViewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const attachViewportListeners = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return { ref: attachViewportListeners };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects listener replacement exposed by a non-hook function", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const userViewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const attachViewportListeners = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return { viewportRef: attachViewportListeners };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a different event",
      release: 'previous.removeEventListener("scroll", onWheel);',
    },
    {
      name: "a different handler",
      release: 'previous.removeEventListener("wheel", onScroll);',
    },
  ])("rejects callback-ref replacement with $name", ({ release }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel, onScroll }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) {
      ${release}
    }
    viewportNodeRef.current = node;
    if (node) {
      node.addEventListener("wheel", onWheel, { passive: false });
    }
  }, [onWheel, onScroll]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects replacement logic that is not used as a JSX callback ref", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const attachViewport = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button onClick={() => attachViewport(document.body)} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects callback-ref replacement that overwrites ownership before release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    viewportNodeRef.current = node;
    const current = viewportNodeRef.current;
    if (current) current.removeEventListener("wheel", onWheel);
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects callback-ref replacement that conditionally skips release", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel, shouldRelease }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (shouldRelease && previous) {
      previous.removeEventListener("wheel", onWheel);
    }
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel, shouldRelease]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects callback-ref replacement that skips release on null unmount", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    if (node) {
      const previous = viewportNodeRef.current;
      if (previous) previous.removeEventListener("wheel", onWheel);
      viewportNodeRef.current = node;
      node.addEventListener("wheel", onWheel, { passive: false });
    }
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects callback-ref ownership assigned only to a value alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    let previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    previous = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a reassigned let alias for the previous callback-ref node", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    let previous = viewportNodeRef.current;
    previous = node;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects callback-ref ownership through a logical assignment", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (previous) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current ||= node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    { name: "loose null", guard: "previous != null" },
    { name: "strict null", guard: "previous !== null" },
  ])("accepts callback-ref replacement guarded by $name", ({ guard }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useRef } from "react";
export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef(null);
  const viewportRef = useCallback((node) => {
    const previous = viewportNodeRef.current;
    if (${guard}) previous.removeEventListener("wheel", onWheel);
    viewportNodeRef.current = node;
    if (node) node.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);
  return <button ref={viewportRef} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
