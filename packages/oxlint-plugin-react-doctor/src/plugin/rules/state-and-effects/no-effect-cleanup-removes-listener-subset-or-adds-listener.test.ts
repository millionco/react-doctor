import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectCleanupRemovesListenerSubsetOrAddsListener } from "./no-effect-cleanup-removes-listener-subset-or-adds-listener.js";

describe("no-effect-cleanup-removes-listener-subset-or-adds-listener", () => {
  it("flags a cleanup that removes only a subset of registered events", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        if (!api) return;
        onSelect();
        api.on("reInit", onSelect);
        api.on("select", onSelect);
        return () => {
          api.off("select", onSelect);
        };
      }, [api, onSelect]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a cleanup that re-adds the listener instead of removing it", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        window.addEventListener('resize', handler);
        return () => {
          window.addEventListener('resize', handler);
        };
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a bare off() that removes all handlers", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        socket.on('reload', onReload);
        socket.on('css', onCss);
        return () => {
          socket.off();
        };
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeAllListeners bulk teardown", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        api.on('select', onChange);
        api.on('reInit', onChange);
        return () => {
          api.removeAllListeners();
        };
      }, [api]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cleanup registering a genuinely different listener", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        map.on('click', onClick);
        return () => {
          map.on('idle', onIdle);
        };
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a complete cleanup that removes every event", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        api.on("reInit", onSelect);
        api.on("select", onSelect);
        return () => {
          api.off("reInit", onSelect);
          api.off("select", onSelect);
        };
      }, [api, onSelect]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a handler-only removal covering multiple events", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        api.on("reInit", onSelect);
        api.on("select", onSelect);
        return () => {
          api.off(onSelect);
        };
      }, [api, onSelect]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat module-scope emitter usage as an effect", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `emitter.on('data', a);
       emitter.on('end', b);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
