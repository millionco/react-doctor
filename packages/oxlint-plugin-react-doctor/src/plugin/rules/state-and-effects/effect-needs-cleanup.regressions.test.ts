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

  it("does not flag a captured subscription disposer in a useCallback", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag a discarded setInterval in a handler that also clears an interval", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag a concise-body socket whose handle is stored in a ref", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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
