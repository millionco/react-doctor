import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectListenerCleanupReferenceMismatch } from "./effect-listener-cleanup-reference-mismatch.js";

describe("effect-listener-cleanup-reference-mismatch", () => {
  it("flags addEventListener + removeEventListener with two distinct arrows", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener('beforeunload', () => save(token));
        return () => {
          window.removeEventListener('beforeunload', () => save(token));
        };
      }, [token]);
      `
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags distinct function expressions on both sides", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        el.addEventListener('scroll', function () { onScroll(); });
        return () => el.removeEventListener('scroll', function () { onScroll(); });
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags EventEmitter on/off with mismatched literals", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        emitter.on('update', (d) => setData(d));
        return () => emitter.off('update', (d) => setData(d));
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags subscribe/unsubscribe with handler-only literals", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        appEvent.subscribe((e) => handle(e));
        return () => appEvent.unsubscribe((e) => handle(e));
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags textually-identical literals since they are still distinct references", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        return () => document.removeEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      }, [close]);
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the same named handler on both sides", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      const onUnload = () => save(token);
      useEffect(() => {
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
      }, [token]);
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hoisted local binding used on both sides", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        const handler = (e) => onScroll(e);
        el.addEventListener('scroll', handler);
        return () => el.removeEventListener('scroll', handler);
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an AbortController teardown with no remove call", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        const controller = new AbortController();
        el.addEventListener('resize', () => onResize(), { signal: controller.signal });
        return () => controller.abort();
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an effect that never calls remove", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener('online', () => sync());
        return () => {};
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag different event strings", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener('resize', () => onResize());
        return () => window.removeEventListener('online', () => sync());
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag different targets with identical event and literal shape", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        a.addEventListener('x', () => f());
        return () => b.removeEventListener('x', () => f());
      }, []);
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
