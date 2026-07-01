import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectCleanupRemovesListenerSubsetOrAddsListener } from "./no-effect-cleanup-removes-listener-subset-or-adds-listener.js";

describe("repro", () => {
  it("FN: unsubscribe on another receiver suppresses subset detection", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        api.on('select', onSelect);
        api.on('reInit', onSelect);
        const subscription = source.subscribe(onValue);
        return () => {
          subscription.unsubscribe();
          api.off('select', onSelect);
        };
      }, []);`,
    );
    console.log("FN-unsubscribe diagnostics:", result.diagnostics.length);
    expect(result.parseErrors).toEqual([]);
  });

  it("FP: chained off() removals", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        emitter.on('open', handler);
        emitter.on('close', handler);
        return () => {
          emitter.off('open', handler).off('close', handler);
        };
      }, []);`,
    );
    console.log("FP-chained diagnostics:", result.diagnostics.length, result.diagnostics);
  });

  it("FP: loop-based cleanup with literal setup", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('touchstart', onOutside);
        return () => {
          ['mousedown', 'touchstart'].forEach((eventName) => {
            document.removeEventListener(eventName, onOutside);
          });
        };
      }, []);`,
    );
    console.log("FP-loop diagnostics:", result.diagnostics.length, result.diagnostics);
  });

  it("FP: nested handler lazily registers, cleanup removes it defensively is fine, but lazy-only", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
        };
        const onMouseDown = () => {
          document.addEventListener('mousemove', onMouseMove);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mouseup', onMouseUp);
          document.removeEventListener('mousemove', onMouseMove);
        };
      }, []);`,
    );
    console.log("nested-covered diagnostics:", result.diagnostics.length);
  });

  it("FP: abort-signal listener plus one manual removal", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        const controller = new AbortController();
        window.addEventListener('keydown', onKey, { signal: controller.signal });
        window.addEventListener('resize', onResize);
        return () => {
          controller.abort();
          window.removeEventListener('resize', onResize);
        };
      }, []);`,
    );
    console.log("FP-signal diagnostics:", result.diagnostics.length, result.diagnostics);
  });

  it("FP: handler alias in setup, original in cleanup", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        const handler = props.onScroll;
        window.addEventListener('scroll', handler);
        window.addEventListener('resize', handler);
        return () => {
          window.removeEventListener('scroll', props.onScroll);
          window.removeEventListener('resize', props.onScroll);
        };
      }, []);`,
    );
    console.log("FP-alias diagnostics:", result.diagnostics.length, result.diagnostics);
  });

  it("FN: removeAllListeners on different receiver suppresses subset detection", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        api.on('select', onSelect);
        api.on('reInit', onSelect);
        player.removeAllListeners;
        return () => {
          player.removeAllListeners();
          api.off('select', onSelect);
        };
      }, []);`,
    );
    console.log("FN-removeAll diagnostics:", result.diagnostics.length);
  });

  it("FP: nested drag registration flagged as accumulating", () => {
    const result = runRule(
      noEffectCleanupRemovesListenerSubsetOrAddsListener,
      `useEffect(() => {
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };
        const onMouseDown = () => {
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => {
          document.removeEventListener('mousedown', onMouseDown);
        };
      }, []);`,
    );
    console.log("FP-nested-drag diagnostics:", result.diagnostics.length, result.diagnostics);
  });
});
