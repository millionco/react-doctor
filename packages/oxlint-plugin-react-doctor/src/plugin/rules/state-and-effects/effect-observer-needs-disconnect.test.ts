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
