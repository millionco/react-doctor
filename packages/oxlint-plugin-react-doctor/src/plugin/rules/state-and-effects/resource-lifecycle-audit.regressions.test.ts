import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";
import { debounceNoCleanup } from "./debounce-no-cleanup.js";
import { effectListenerCleanupReferenceMismatch } from "./effect-listener-cleanup-reference-mismatch.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";
import { effectRafLoopNeedsCancel } from "./effect-raf-loop-needs-cancel.js";
import { effectRemoveListenerInlineHandler } from "./effect-remove-listener-inline-handler.js";
import { mobxReactionDisposerDiscarded } from "../mobx/mobx-reaction-disposer-discarded.js";
import { noEffectWrapperDiscardsCallbackCleanupReturn } from "./no-effect-wrapper-discards-callback-cleanup-return.js";

const expectDiagnosticCount = (
  rule: Parameters<typeof runRule>[0],
  code: string,
  diagnosticCount: number,
): void => {
  const result = runRule(rule, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("resource lifecycle audit regressions", () => {
  it("distinguishes class-owned resources from same-looking local and unrelated teardown", () => {
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `import { setInterval } from "custom"; class C extends React.Component { componentDidMount() { setInterval(this.tick, 10); } render() { return null; } }`,
      0,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component { componentDidMount() { const bus = this.props.bus; bus.on("data", this.handle); } render() { return null; } }`,
      1,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component { componentDidMount() { other.removeEventListener("resize", noop); window.addEventListener("resize", this.handle); } render() { return null; } }`,
      1,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `const disposeOnUnmount = () => {}; class C extends React.Component { componentDidMount() { disposeOnUnmount(); window.addEventListener("resize", this.handle); } render() { return null; } }`,
      1,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component { tick = () => this.setState({ now: Date.now() }); componentDidMount() { setTimeout(this.tick, 10); } render() { return null; } }`,
      1,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component { componentDidMount() { window.addEventListener("resize", this.handle, { ["once"]: true }); } render() { return null; } }`,
      1,
    );
  });

  it("requires a reachable cancellation of the exact debounce binding", () => {
    const prefix = `import { debounce } from "lodash";`;
    expectDiagnosticCount(
      debounceNoCleanup,
      `${prefix} function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10), []); useEffect(() => { search(); search.cancel; }, [search]); }`,
      1,
    );
    expectDiagnosticCount(
      debounceNoCleanup,
      `${prefix} function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10), []); useEffect(() => { search(); const unused = () => search.cancel(); }, [search]); }`,
      1,
    );
    expectDiagnosticCount(
      debounceNoCleanup,
      `${prefix} function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10), []); useEffect(() => { search(); ({ search, cancel() {} }).cancel(); }, [search]); }`,
      1,
    );
    expectDiagnosticCount(
      debounceNoCleanup,
      `${prefix} function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10, { ["trailing"]: false }), []); useEffect(() => search(), [search]); }`,
      0,
    );
    expectDiagnosticCount(
      debounceNoCleanup,
      `${prefix} const useMemo = (factory) => factory(); function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10), []); useEffect(() => search(), [search]); }`,
      0,
    );
    expectDiagnosticCount(
      debounceNoCleanup,
      `${prefix} function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10), []); useEffect(() => { search(); const unused = () => { const search = other; search.cancel(); }; }, [search]); }`,
      1,
    );
  });

  it("matches observer teardown by call order, binding, and observed target", () => {
    expectDiagnosticCount(
      effectObserverNeedsDisconnect,
      `useEffect(() => { const obs = new ResizeObserver(cb); obs.observe(el); return () => { obs.disconnect; }; }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectObserverNeedsDisconnect,
      `useEffect(() => { const obs = new ResizeObserver(cb); obs.disconnect(); obs.observe(el); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectObserverNeedsDisconnect,
      `useEffect(() => { const obs = new ResizeObserver(cb); obs.observe(el); return () => obs.unobserve(other); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectObserverNeedsDisconnect,
      `useEffect(() => { const obs = new ResizeObserver(() => { function unused(obs) { obs.disconnect(); } }); obs.observe(el); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectObserverNeedsDisconnect,
      `useEffect(() => { const obs = new window["ResizeObserver"](cb); obs.observe(el); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectObserverNeedsDisconnect,
      `useEffect(() => { const obs = (new ResizeObserver(cb) as ResizeObserver); obs.observe(el); }, []);`,
      1,
    );
  });

  it("requires every unbounded RAF loop to stop through its own handle or guard", () => {
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { let id; const loop = () => { id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); return () => console.log(id); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `function C() { useEffect(() => { let id; const loop = () => { id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); return () => cancelAnimationFrame(otherId); }, []); const onScroll = () => cancelAnimationFrame(id); }`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { requestAnimationFrame(() => {}); let id; const loop = () => { id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); return () => cancelAnimationFrame(oneShotId); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { const state = { running: true, mounted: true }; const loop = () => { if (!state.running) return; requestAnimationFrame(loop); }; requestAnimationFrame(loop); return () => { state.mounted = false; }; }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { const limit = 1; const loop = () => { if (limit < 2) requestAnimationFrame(loop); }; requestAnimationFrame(loop); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { const finite = (now) => { const progress = Math.min(now / 100, 1); if (progress < 1) requestAnimationFrame(finite); }; requestAnimationFrame(finite); const leaked = () => requestAnimationFrame(leaked); requestAnimationFrame(leaked); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { let id; const loop = () => { id = (requestAnimationFrame(loop) as number); }; id = (requestAnimationFrame(loop) as number); return () => cancelAnimationFrame(id); }, []);`,
      0,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { const unused = () => requestAnimationFrame(function loop() { requestAnimationFrame(loop); }); }, []);`,
      0,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `const requestAnimationFrame = customScheduler; useEffect(() => requestAnimationFrame(function loop() { requestAnimationFrame(loop); }), []);`,
      0,
    );
  });

  it("limits listener diagnostics to identity-based removal APIs", () => {
    expectDiagnosticCount(
      effectRemoveListenerInlineHandler,
      `device.off("power", () => done());`,
      0,
    );
    expectDiagnosticCount(
      effectRemoveListenerInlineHandler,
      `mql.addListener(update); mql.removeListener(() => update());`,
      1,
    );
    expectDiagnosticCount(
      effectRemoveListenerInlineHandler,
      `window.addEventListener("resize", update); window["removeEventListener"]("resize", () => update());`,
      1,
    );
  });

  it("recognizes only effective MobX disposal contexts", () => {
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx"; function mount() { autorun(work, { signal: undefined }); }`,
      1,
    );
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx"; function C() { const setupTracking = () => { autorun(work); }; setupTracking(); return null; }`,
      1,
    );
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx"; function mount() { void autorun(work); }`,
      1,
    );
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { reaction } from "mobx"; function mount() { (reaction(read, write), 0); }`,
      1,
    );
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx"; class Store { static { autorun(work); } }`,
      0,
    );
  });

  it("proves wrapper hook and callback bindings through TypeScript forms", () => {
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useEffect = (fn) => fn(); const useWrapped = (effect: EffectCallback) => { useEffect(() => { effect(); }); };`,
      0,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: EffectCallback) => { useEffect(() => { const effect = () => {}; effect(); }); };`,
      0,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: React.EffectCallback) => { useEffect(() => { effect(); }); };`,
      1,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: () => () => void) => { useEffect(() => { effect(); }); };`,
      1,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped = (effect: EffectCallback) => { useEffect(() => { (effect as EffectCallback)(); }); };`,
      1,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `const useWrapped: typeof React.useEffect = (effect, deps) => { useEffect(() => { effect(); }, deps); };`,
      1,
    );
  });

  it("compares listener and teardown references by binding identity", () => {
    expectDiagnosticCount(
      effectListenerCleanupReferenceMismatch,
      `useEffect(() => { { const source = first; source.subscribe(() => consume()); } return () => { const source = second; source.unsubscribe(() => consume()); }; }, []);`,
      0,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component { componentDidMount() { { const target = first; target.addEventListener("data", this.handle); } { const target = second; target.removeEventListener("data", this.handle); } } render() { return null; } }`,
      1,
    );
  });

  it("does not mistake unrelated ownership APIs for resource teardown", () => {
    expectDiagnosticCount(
      debounceNoCleanup,
      `import { debounce } from "lodash"; function C() { const search = useMemo(() => debounce(async () => fetch("/x"), 10), []); const wrapper = { search, cancel() {} }; useEffect(() => { search(); return () => wrapper.cancel(); }, [search]); }`,
      1,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `class C extends React.Component { componentDidMount() { const bus = getGlobalBus(); bus.on("data", this.handle); } render() { return null; } }`,
      1,
    );
    expectDiagnosticCount(
      classComponentMissingComponentWillUnmountTeardown,
      `import { disposeOnUnmount } from "mobx-react"; class C extends React.Component { componentDidMount() { window.addEventListener("resize", this.handle); disposeOnUnmount(otherStore, otherStore.dispose); } render() { return null; } }`,
      1,
    );
  });

  it("recognizes ownership-losing MobX and effect-wrapper expressions", () => {
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx"; function mountFeature() { if (autorun(() => state.value)) consume(); }`,
      1,
    );
    expectDiagnosticCount(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx"; function mountFeature() { autorun(() => state.value, ({ delay: 10 } satisfies IAutorunOptions)); }`,
      1,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `import { useEffect } from "react"; function useForward(effect: React.EffectCallback) { useEffect(() => { void effect(); }, [effect]); }`,
      1,
    );
    expectDiagnosticCount(
      noEffectWrapperDiscardsCallbackCleanupReturn,
      `import { useEffect } from "react"; function useForward(effect: React.EffectCallback) { useEffect(() => { (effect(), undefined); }, [effect]); }`,
      1,
    );
  });

  it("requires numeric RAF guards to make monotonic progress toward the bound", () => {
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { let progress = 0; function loop() { progress -= 0.1; if (progress < 1) requestAnimationFrame(loop); } requestAnimationFrame(loop); }, []);`,
      1,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { let progress = 0; function loop() { progress += 0.1; if (progress < 1) requestAnimationFrame(loop); } requestAnimationFrame(loop); }, []);`,
      0,
    );
    expectDiagnosticCount(
      effectRafLoopNeedsCancel,
      `useEffect(() => { const loop = (timestamp) => { const progress = Math.min(timestamp / 100, 1); if (progress < 1) requestAnimationFrame(loop); }; requestAnimationFrame(loop); }, []);`,
      0,
    );
  });
});
