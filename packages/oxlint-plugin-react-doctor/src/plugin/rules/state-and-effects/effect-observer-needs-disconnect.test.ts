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

  it("does not flag a cleanup that delegates the release to a helper receiving the observer", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag an observer pushed into a registry that disconnects it elsewhere", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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
});
