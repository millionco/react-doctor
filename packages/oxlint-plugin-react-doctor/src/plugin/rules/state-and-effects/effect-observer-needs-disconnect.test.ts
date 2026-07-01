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
});
