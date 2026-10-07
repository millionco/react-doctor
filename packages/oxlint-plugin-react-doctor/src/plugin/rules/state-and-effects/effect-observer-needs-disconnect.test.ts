import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

describe("effect-observer-needs-disconnect", () => {
  it("flags a ResizeObserver observed without disconnect", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new ResizeObserver(() => measure());
        observer.observe(el);
      }, []);
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an IntersectionObserver without release in useLayoutEffect", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useLayoutEffect(() => {
        const io = new IntersectionObserver((entries) => onIntersect(entries));
        io.observe(node);
      }, [node]);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a MutationObserver without disconnect", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const mo = new MutationObserver(cb);
        mo.observe(target, { childList: true });
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the cleanup return disconnects", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new ResizeObserver(() => measure());
        observer.observe(el);
        return () => observer.disconnect();
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag observers retained and disconnected through one local collection", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observers = [];
         for (const element of elements) {
           const observer = new ResizeObserver(() => updateSize());
           observer.observe(element);
           observers.push(observer);
         }
         return () => observers.forEach((observer) => observer.disconnect());
       }, [elements]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a MutationObserver collection built while walking ancestors", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useLayoutEffect(() => {
         if (!element) return;
         const observers = [];
         for (let node = element; node; node = node.parentElement) {
           const observer = new MutationObserver(detect);
           observer.observe(node, { attributes: true });
           observers.push(observer);
         }
         return () => observers.forEach((observer) => observer.disconnect());
       }, [element]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags conditional retention or cleanup through a mutated collection", () => {
    const conditionalRetention = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observers = [];
         const observer = new ResizeObserver(update);
         observer.observe(element);
         if (shouldRetain) observers.push(observer);
         return () => observers.forEach((observer) => observer.disconnect());
       }, [element, shouldRetain]);`,
    );
    const conditionalCleanup = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observers = [];
         const observer = new ResizeObserver(update);
         observer.observe(element);
         observers.push(observer);
         return () => {
           if (shouldCleanup) observers.forEach((observer) => observer.disconnect());
         };
       }, [element, shouldCleanup]);`,
    );
    const mutatedCollection = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observers = [];
         const observer = new ResizeObserver(update);
         observer.observe(element);
         observers.push(observer);
         observers.pop();
         return () => observers.forEach((observer) => observer.disconnect());
       }, [element]);`,
    );
    expect(conditionalRetention.diagnostics).toHaveLength(1);
    expect(conditionalCleanup.diagnostics).toHaveLength(1);
    expect(mutatedCollection.diagnostics).toHaveLength(1);
  });

  it("requires collection cleanup on every return path after observation", () => {
    const emptyCleanupBranch = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observers = [];
         const observer = new ResizeObserver(update);
         observer.observe(element);
         observers.push(observer);
         if (enabled) return () => observers.forEach((observer) => observer.disconnect());
         return () => {};
       }, [element, enabled]);`,
    );
    const bareReturnBranch = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observers = [];
         const observer = new ResizeObserver(update);
         observer.observe(element);
         observers.push(observer);
         if (enabled) return () => observers.forEach((observer) => observer.disconnect());
         return;
       }, [element, enabled]);`,
    );
    expect(emptyCleanupBranch.diagnostics).toHaveLength(1);
    expect(bareReturnBranch.diagnostics).toHaveLength(1);
  });

  it("does not flag a bound disconnect returned through a local alias", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => measure());
         observer.observe(node);
         const disconnect = observer.disconnect.bind(observer);
         const cleanup = disconnect;
         return cleanup;
       }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat observer bind this arguments as ownership escapes", () => {
    const callbackBinding = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         callback.bind(observer);
         observer.observe(node);
       }, []);`,
    );
    const extractedMethodBinding = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const extractedDisconnect = observer.disconnect;
         extractedDisconnect.bind(observer);
         observer.observe(node);
       }, []);`,
    );
    expect(callbackBinding.diagnostics).toHaveLength(1);
    expect(extractedMethodBinding.diagnostics).toHaveLength(1);
  });

  it("tracks transparent wrappers in bound observer disconnect cleanups", () => {
    const castMethod = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.observe(target);
         return (observer.disconnect as any).bind(observer);
       }, []);`,
    );
    const assertedMethod = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.observe(target);
         return observer.disconnect!.bind(observer);
       }, []);`,
    );
    const wrongMethod = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.observe(target);
         return (observer.unobserve as any).bind(observer);
       }, []);`,
    );
    const wrongTarget = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.observe(target);
         return (other.disconnect as any).bind(other);
       }, []);`,
    );
    const wrongReceiver = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.observe(target);
         return (observer.disconnect as any).bind(other);
       }, []);`,
    );
    expect(castMethod.diagnostics).toHaveLength(0);
    expect(assertedMethod.diagnostics).toHaveLength(0);
    expect(wrongMethod.diagnostics).toHaveLength(1);
    expect(wrongTarget.diagnostics).toHaveLength(1);
    expect(wrongReceiver.diagnostics).toHaveLength(1);
  });

  it("does not flag when the cleanup return unobserves", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const resizeObserver = new ResizeObserver(() => measure());
        resizeObserver.observe(element);
        return () => resizeObserver.unobserve(element);
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag matching forEach acquisition and cleanup recipes", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `const useActiveItem = (itemIds) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        itemIds.forEach((itemId) => {
          const element = document.getElementById(itemId);
          if (element) observer.observe(element);
        });
        return () => {
          itemIds.forEach((itemId) => {
            const element = document.getElementById(itemId);
            if (element) observer.unobserve(element);
          });
        };
      }, [itemIds]); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a forEach cleanup that derives a different target", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        itemIds.forEach((itemId) => observer.observe(document.getElementById(itemId)));
        return () => {
          itemIds.forEach((itemId) => observer.unobserve(document.querySelector(itemId)));
        };
      }, [itemIds]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not equate mismatched guards, mutated collections, or opaque target calls", () => {
    const sources = [
      `useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach((item) => { if (item.active) observer.observe(item); });
        return () => items.forEach((item) => { if (!item.active) observer.unobserve(item); });
      }, [items]);`,
      `useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach((item) => observer.observe(item));
        items.length = 0;
        return () => items.forEach((item) => observer.unobserve(item));
      }, [items]);`,
      `useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach((item) => observer.observe(getNode(item)));
        return () => items.forEach((item) => observer.unobserve(getNode(item)));
      }, [items]);`,
    ];
    for (const source of sources) {
      expect(runRule(effectObserverNeedsDisconnect, source).diagnostics).toHaveLength(1);
    }
  });

  it("does not equate conditional, asynchronous, or mutation-sensitive iteration recipes", () => {
    const sources = [
      `const useItems = (items, enabled) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach((item) => observer.observe(item));
        return () => {
          if (enabled) items.forEach((item) => observer.unobserve(item));
        };
      }, [items, enabled]); };`,
      `const useItems = (items) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        let enabled = true;
        items.forEach((item) => { if (enabled) observer.observe(item); });
        enabled = false;
        return () => items.forEach((item) => {
          if (enabled) observer.unobserve(item);
        });
      }, [items]); };`,
      `const useItems = (items, replacement) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach((item) => {
          let target = item;
          target = replacement;
          observer.observe(target);
        });
        return () => items.forEach((item) => observer.unobserve(item));
      }, [items, replacement]); };`,
      `const useItems = (items, replacement) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach((item) => {
          item = replacement;
          observer.observe(item);
        });
        return () => items.forEach((item) => observer.unobserve(item));
      }, [items, replacement]); };`,
      `const useItems = (items) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        items.forEach(async (item) => {
          await ready();
          observer.observe(item);
        });
        return () => items.forEach((item) => observer.unobserve(item));
      }, [items]); };`,
    ];
    for (const source of sources) {
      expect(runRule(effectObserverNeedsDisconnect, source).diagnostics).toHaveLength(1);
    }
  });

  it("equates an unreassigned collection alias with its source collection", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `const useItems = (items) => { useEffect(() => {
        const observer = new IntersectionObserver(handleEntries);
        const targets = items;
        targets.forEach((item) => observer.observe(item));
        return () => items.forEach((item) => observer.unobserve(item));
      }, [items]); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags observing again after an earlier disconnect or unobserve", () => {
    const disconnectResult = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => measure());
         observer.observe(firstNode);
         observer.disconnect();
         observer.observe(secondNode);
       }, []);`,
    );
    const unobserveResult = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => measure());
         observer.observe(node);
         observer.unobserve(node);
         observer.observe(node);
       }, []);`,
    );
    expect(disconnectResult.diagnostics).toHaveLength(1);
    expect(unobserveResult.diagnostics).toHaveLength(1);
  });

  it("tracks observer acquisition and cleanup inside synchronous iterator callbacks", () => {
    const leakedResult = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         [node].forEach((target) => {
           const observer = new ResizeObserver(() => measure());
           observer.observe(target);
         });
       }, []);`,
    );
    const releasedResult = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => measure());
         [node].forEach((target) => observer.observe(target));
         return () => callbacks.forEach(() => observer.disconnect());
       }, []);`,
    );
    expect(leakedResult.diagnostics).toHaveLength(1);
    expect(releasedResult.diagnostics).toHaveLength(0);
  });

  it("resolves synchronous helper calls by binding identity", () => {
    const shadowedAcquisition = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const observe = () => observer.observe(node);
         [noop].forEach((observe) => observe());
       }, []);`,
    );
    const shadowedRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const disconnect = () => observer.disconnect();
         observer.observe(node);
         [noop].forEach((disconnect) => disconnect());
       }, []);`,
    );
    expect(shadowedAcquisition.diagnostics).toHaveLength(0);
    expect(shadowedRelease.diagnostics).toHaveLength(1);
  });

  it("preserves observer acquisition and release order across synchronous callbacks", () => {
    const iteratorAcquireBeforeRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         [first, second].forEach((target) => observer.observe(target));
         observer.disconnect();
       }, []);`,
    );
    const iteratorReleaseBeforeAcquire = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.disconnect();
         [first, second].forEach((target) => observer.observe(target));
       }, []);`,
    );
    const helperAcquireBeforeRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const start = () => observer.observe(target);
         start();
         observer.disconnect();
       }, []);`,
    );
    const helperReleaseBeforeAcquire = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const start = () => observer.observe(target);
         observer.disconnect();
         start();
       }, []);`,
    );
    const nestedAcquireBeforeRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         [target]
           .map((currentTarget) => {
             observer.observe(currentTarget);
             return currentTarget;
           })
           .forEach(() => observer.disconnect());
       }, []);`,
    );
    const nestedReleaseBeforeAcquire = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         [target]
           .map((currentTarget) => {
             observer.disconnect();
             return currentTarget;
           })
           .forEach((currentTarget) => observer.observe(currentTarget));
       }, []);`,
    );
    expect(iteratorAcquireBeforeRelease.diagnostics).toHaveLength(0);
    expect(iteratorReleaseBeforeAcquire.diagnostics).toHaveLength(1);
    expect(helperAcquireBeforeRelease.diagnostics).toHaveLength(0);
    expect(helperReleaseBeforeAcquire.diagnostics).toHaveLength(1);
    expect(nestedAcquireBeforeRelease.diagnostics).toHaveLength(0);
    expect(nestedReleaseBeforeAcquire.diagnostics).toHaveLength(1);
  });

  it("follows wrapped helper and synchronous callback entry points", () => {
    const wrappedHelperBeforeRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const start = () => observer.observe(target);
         (start as typeof start)();
         observer.disconnect();
       }, []);`,
    );
    const releaseBeforeWrappedHelper = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         const start = () => observer.observe(target);
         observer.disconnect();
         (start as typeof start)();
       }, []);`,
    );
    const wrappedIteratorBeforeRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         ([target].forEach as typeof Array.prototype.forEach)(
           (currentTarget) => observer.observe(currentTarget),
         );
         observer.disconnect();
       }, []);`,
    );
    const wrappedCallbackBeforeRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         [target].forEach(
           ((currentTarget) => observer.observe(currentTarget)) as (target: Element) => void,
         );
         observer.disconnect();
       }, []);`,
    );
    expect(wrappedHelperBeforeRelease.diagnostics).toHaveLength(0);
    expect(releaseBeforeWrappedHelper.diagnostics).toHaveLength(1);
    expect(wrappedIteratorBeforeRelease.diagnostics).toHaveLength(0);
    expect(wrappedCallbackBeforeRelease.diagnostics).toHaveLength(0);
  });

  it("does not flag when every active observation is released after restarting", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => measure());
         observer.observe(firstNode);
         observer.disconnect();
         observer.observe(secondNode);
         observer.unobserve(secondNode);
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-shot observer that disconnects inside its own callback", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const io = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            onVisible();
            io.disconnect();
          }
        });
        io.observe(node);
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an observer released inside a reduce callback", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new IntersectionObserver((entries, currentObserver) => {
           entries.reduce((didDisconnect, entry) => {
             if (entry.isIntersecting) currentObserver.disconnect();
             return didDisconnect || entry.isIntersecting;
           }, false);
         });
         observer.observe(node);
       }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an observer created at module scope", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `const observer = new ResizeObserver(() => measure()); observer.observe(el);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an observer constructed but never observed", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new ResizeObserver(() => measure());
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust an opaque cleanup helper receiving the observer", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new ResizeObserver(handleResize);
        observer.observe(node);
        return () => cleanupObserver(observer);
      }, [node]);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an observer stashed in a ref whose outer named cleanup is returned by reference", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      const stopObserving = () => observerRef.current?.disconnect();
      useEffect(() => {
        observerRef.current = new ResizeObserver(cb);
        observerRef.current.observe(el);
        return stopObserving;
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an unproven registry push as observer cleanup", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new IntersectionObserver(onIntersect);
        observer.observe(node);
        activeObservers.push(observer);
        return flushObservers;
      }, [node]);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat logging an observer as ownership transfer", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
        const observer = new ResizeObserver(cb);
        observer.observe(node);
        console.log(observer);
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an observer aliased to another binding that releases it", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new MutationObserver(cb);
        observer.observe(target, { childList: true });
        const disposer = observer;
        return () => disposer.disconnect();
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the leaked observer when a second observer in the same effect is disconnected", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(el);
        const mutationObserver = new MutationObserver(onMutate);
        mutationObserver.observe(el, { childList: true });
        return () => resizeObserver.disconnect();
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when the only disconnect belongs to an unrelated object like a socket", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const observer = new ResizeObserver(cb);
        observer.observe(el);
        const socket = connect(url);
        return () => socket.disconnect();
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a global-qualified window.ResizeObserver observed without disconnect", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        if (!('ResizeObserver' in window)) return;
        const observer = new window.ResizeObserver(cb);
        observer.observe(el);
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-observer new expression with observe", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `
      useEffect(() => {
        const thing = new Telescope(cb);
        thing.observe(star);
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Reveal-once IntersectionObserver releasing each target via the callback's second parameter (obs.unobserve)", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
  const node = ref.current;
  if (!node) return;
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("animate-fade-in");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 },
  );
  observer.observe(node);
}, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Lazy-load IntersectionObserver one-shot disconnecting via the destructured-callback observer parameter", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
  const img = imageRef.current;
  if (!img) return;
  const observer = new IntersectionObserver(([entry], obs) => {
    if (entry.isIntersecting) {
      setShouldLoad(true);
      obs.disconnect();
    }
  });
  observer.observe(img);
}, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Buffered PerformanceObserver FCP one-shot disconnecting via the callback parameter", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
  if (typeof PerformanceObserver === "undefined") return;
  const observer = new PerformanceObserver((entryList, perfObserver) => {
    for (const entry of entryList.getEntries()) {
      if (entry.name === "first-contentful-paint") {
        reportMetric("FCP", entry.startTime);
        perfObserver.disconnect();
      }
    }
  });
  observer.observe({ type: "paint", buffered: true });
}, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: MutationObserver wait-for-element one-shot (focus a portal dialog) disconnecting via the callback parameter", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  const observer = new MutationObserver((mutations, mutationObserver) => {
    const dialog = container.querySelector("[role='dialog']");
    if (dialog instanceof HTMLElement) {
      dialog.focus();
      mutationObserver.disconnect();
    }
  });
  observer.observe(container, { childList: true, subtree: true });
}, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: ResizeObserver initial post-layout measure one-shot disconnecting via the callback parameter", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
  const node = ref.current;
  if (!node) return;
  const observer = new ResizeObserver(([entry], resizeObserver) => {
    setInitialHeight(entry.contentRect.height);
    resizeObserver.disconnect();
  });
  observer.observe(node);
}, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an observer whose two-param callback never releases", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new IntersectionObserver((entries, obs) => {
           entries.forEach((entry) => setVisible(entry.isIntersecting));
         });
         observer.observe(ref.current);
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores releases on bindings shadowing the observer callback parameter", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new IntersectionObserver((entries, currentObserver) => {
           entries.forEach((entry) => {
             const currentObserver = makeObserverController(entry);
             currentObserver.disconnect();
           });
         });
         observer.observe(ref.current);
       }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when cleanup unobserves only one of multiple targets", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         observer.observe(first);
         observer.observe(second);
         return () => observer.unobserve(first);
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks observers and targets by binding identity", () => {
    const shadowedObserver = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         { const observer = new ResizeObserver(callback); observer.observe(first); observer.disconnect(); }
         { const observer = new ResizeObserver(callback); observer.observe(second); }
       }, []);`,
    );
    expect(shadowedObserver.diagnostics).toHaveLength(1);

    const shadowedTarget = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(callback);
         { const target = first; observer.observe(target); }
         return () => { const target = second; observer.unobserve(target); };
       }, []);`,
    );
    expect(shadowedTarget.diagnostics).toHaveLength(1);
  });

  it("tracks static computed observer lifecycle methods", () => {
    const released = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         observer["observe"](element);
         return () => observer[\`disconnect\`]();
       }, [element]);`,
    );
    const leaked = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         observer["observe"](element);
       }, [element]);`,
    );
    const partialRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         observer["observe"](first);
         observer[\`observe\`](second);
         return () => observer["unobserve"](first);
       }, [first, second]);`,
    );
    const wrongRelease = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         observer["observe"](first);
         return () => observer[\`unobserve\`](second);
       }, [first, second]);`,
    );
    expect(released.diagnostics).toHaveLength(0);
    expect(leaked.diagnostics).toHaveLength(1);
    expect(partialRelease.diagnostics).toHaveLength(1);
    expect(wrongRelease.diagnostics).toHaveLength(1);
  });

  it("does not treat one callback-parameter unobserve as releasing every target", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver((_entries, currentObserver) => {
           currentObserver.unobserve(first);
         });
         observer.observe(first);
         observer.observe(second);
       }, [first, second]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat one observer entry unobserve as releasing every target", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver((entries, currentObserver) => {
           currentObserver.unobserve(entries[0].target);
         });
         observer.observe(first);
         observer.observe(second);
       }, [first, second]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a short-circuiting entry iterator as releasing every target", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver((entries, currentObserver) => {
           entries.find((entry) => {
             currentObserver.unobserve(entry.target);
             return true;
           });
         });
         observer.observe(first);
         observer.observe(second);
       }, [first, second]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks observe calls through a local observer alias", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         const localObserver = observer;
         localObserver.observe(element);
       }, [element]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks disconnect calls through a local observer alias", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         const localObserver = observer;
         localObserver.observe(element);
         return () => localObserver.disconnect();
       }, [element]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an observer member as an identity alias", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         const unrelated = observer.unrelated;
         observer.observe(element);
         return () => unrelated.disconnect();
       }, [element]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unproven useRef call as an identity alias", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         const unrelated = useRef(observer);
         observer.observe(element);
         return () => unrelated.disconnect();
       }, [element]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("matches bound disconnect cleanups through observer aliases", () => {
    const released = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         const localObserver = observer;
         localObserver.observe(element);
         return localObserver.disconnect.bind(localObserver);
       }, [element]);`,
    );
    const wrongReceiver = runRule(
      effectObserverNeedsDisconnect,
      `useEffect(() => {
         const observer = new ResizeObserver(() => {});
         const localObserver = observer;
         localObserver.observe(element);
         return localObserver.disconnect.bind(otherObserver);
       }, [element, otherObserver]);`,
    );
    expect(released.diagnostics).toHaveLength(0);
    expect(wrongReceiver.diagnostics).toHaveLength(1);
  });
});
