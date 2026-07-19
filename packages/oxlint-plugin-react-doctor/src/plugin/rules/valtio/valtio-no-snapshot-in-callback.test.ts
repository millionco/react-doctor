import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { valtioNoSnapshotInCallback } from "./valtio-no-snapshot-in-callback.js";

const getDiagnosticCount = (code: string): number =>
  runRule(valtioNoSnapshotInCallback, code).diagnostics.length;

describe("valtio-no-snapshot-in-callback", () => {
  it("requires Valtio 1+, where useSnapshot is a stable public API", () => {
    expect(valtioNoSnapshotInCallback.requires).toEqual(["valtio", "valtio:1"]);
  });

  it("reports a snapshot member read in an inline JSX event handler", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        const Counter = () => {
          const snap = useSnapshot(state);
          return <button onClick={() => console.log(snap.count)}>{snap.count}</button>;
        };
      `),
    ).toBe(1);
  });

  it("reports named and aliased snapshot bindings wired to JSX handlers", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot as readSnapshot } from "valtio/react";
        function Counter() {
          const snap = readSnapshot(state);
          const current = snap;
          const handleClick = () => console.log(current.count);
          return <button onClick={handleClick}>read</button>;
        }
      `),
    ).toBe(1);
  });

  it("reports handlers wired through const alias chains", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          const handleClick = () => console.log(snap.count);
          const firstAlias = handleClick;
          const secondAlias = firstAlias;
          return <button onClick={secondAlias}>read</button>;
        }
      `),
    ).toBe(1);
  });

  it("reports namespace imports and transparent TypeScript wrappers", () => {
    expect(
      getDiagnosticCount(`
        import * as Valtio from "valtio";
        interface Handler { (): void }
        function Counter() {
          const snap = (Valtio.useSnapshot(state) as State)!;
          const handleClick = (() => console.log((snap as State)!.count)) satisfies Handler;
          return <button onClick={handleClick}>read</button>;
        }
      `),
    ).toBe(1);
  });

  it("reports TypeScript-wrapped handlers assigned to existing bindings", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        interface Handler { (): void }
        let handleClick: Handler;
        function Counter() {
          const snap = useSnapshot(state);
          handleClick = (() => console.log(snap.count)) satisfies Handler;
          return <button onClick={handleClick}>read</button>;
        }
      `),
    ).toBe(1);
  });

  it("reports const aliases of named hooks and namespace imports", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        import * as Valtio from "valtio/react";
        const readSnapshot = useSnapshot;
        const ValtioReact = Valtio;
        function Counter() {
          const first = readSnapshot(state);
          const second = ValtioReact.useSnapshot(otherState);
          return <button onClick={() => console.log(first.count, second.count)}>read</button>;
        }
      `),
    ).toBe(2);
  });

  it("reports React effect callbacks through aliases and namespace calls", () => {
    expect(
      getDiagnosticCount(`
        import React from "react";
        import { useEffect as afterCommit } from "react";
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          afterCommit(() => console.log(snap.count), []);
          React.useLayoutEffect(() => console.log(snap.label), []);
          return null;
        }
      `),
    ).toBe(2);
  });

  it("reports effect reads when the snapshot also feeds stable callbacks", () => {
    expect(
      getDiagnosticCount(`
        import { useCallback, useEffect } from "react";
        import { useSnapshot } from "valtio";
        const useConsentToast = () => {
          const snap = useSnapshot(consentState);
          const acceptAll = useCallback(() => snap.acceptAll(), [snap.acceptAll]);
          useEffect(() => {
            if (snap.showConsentToast) toast(acceptAll);
          }, [snap.showConsentToast]);
          return snap.hasConsented;
        };
      `),
    ).toBe(1);
  });

  it("reports direct and aliased React effect cleanup callbacks", () => {
    expect(
      getDiagnosticCount(`
        import { useEffect, useLayoutEffect } from "react";
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          useEffect(() => () => console.log(snap.count), []);
          useLayoutEffect(() => {
            const cleanup = () => console.log(snap.label);
            return cleanup;
          }, []);
          const effectBody = () => () => console.log(snap.enabled);
          const aliasedEffectBody = effectBody;
          useEffect(aliasedEffectBody, []);
          return null;
        }
      `),
    ).toBe(3);
  });

  it("reports global timers, schedulers, observers, and promise continuations", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          setTimeout(() => console.log(snap.a), 0);
          window.requestAnimationFrame(() => console.log(snap.b));
          queueMicrotask(() => console.log(snap.c));
          new ResizeObserver(() => console.log(snap.d));
          Promise.resolve().then(() => console.log(snap.e));
          return null;
        }
      `),
    ).toBe(5);
  });

  it("reports listener and subscription callbacks passed inline or by reference", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          const onResize = () => console.log(snap.width);
          window.addEventListener("resize", onResize);
          store.subscribe(() => console.log(snap.count));
          emitter.on("change", () => console.log(snap.label));
          return null;
        }
      `),
    ).toBe(3);
  });

  it("reports synchronous nested callbacks when their enclosing callback is deferred", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          return <button onClick={() => snap.items.map((item) => item + snap.offset)}>read</button>;
        }
      `),
    ).toBe(2);
  });

  it("reports local helpers invoked from a deferred callback", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          const readCount = () => snap.count;
          return <button onClick={() => readCount()}>read</button>;
        }
      `),
    ).toBe(1);
  });

  it("reports destructuring performed inside a deferred callback", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          return <button onClick={() => { const { count } = snap; console.log(count); }}>read</button>;
        }
      `),
    ).toBe(1);
  });

  it("allows direct proxy reads in callbacks", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          return <button onClick={() => console.log(state.count)}>{snap.count}</button>;
        }
      `),
    ).toBe(0);
  });

  it("allows snapshot reads in render and synchronous iteration callbacks", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function List() {
          const snap = useSnapshot(state);
          const labels = snap.items.map((item) => item.label + snap.suffix);
          const visible = snap.items.filter(function filterItem(item) { return item.visible && snap.enabled; });
          return <>{labels.join(",")}{visible.length}</>;
        }
      `),
    ).toBe(0);
  });

  it("allows synchronous helpers invoked during render", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          const readCount = () => snap.count;
          return <span>{readCount()}</span>;
        }
      `),
    ).toBe(0);
  });

  it("allows a render-time destructure captured by a handler", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const { count } = useSnapshot(state);
          return <button onClick={() => console.log(count)}>read</button>;
        }
      `),
    ).toBe(0);
  });

  it("allows unknown callback arguments without proof that they are deferred", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          runWithValue(() => console.log(snap.count));
          return null;
        }
      `),
    ).toBe(0);
  });

  it("allows same-named imports from other modules and local shadowing", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "other-store";
        import * as Valtio from "valtio";
        function First() {
          const snap = useSnapshot(state);
          return <button onClick={() => console.log(snap.count)}>read</button>;
        }
        function Second() {
          const Valtio = { useSnapshot: (value) => value };
          const snap = Valtio.useSnapshot(state);
          return <button onClick={() => console.log(snap.count)}>read</button>;
        }
      `),
    ).toBe(0);
  });

  it("allows shadowed timers and React effect names", () => {
    expect(
      getDiagnosticCount(`
        import { useEffect } from "other-hooks";
        import { useSnapshot } from "valtio";
        function Counter() {
          const setTimeout = (callback) => callback();
          const snap = useSnapshot(state);
          setTimeout(() => console.log(snap.count), 0);
          useEffect(() => console.log(snap.label));
          return null;
        }
      `),
    ).toBe(0);
  });

  it("allows unused nested helpers and snapshot aliases", () => {
    expect(
      getDiagnosticCount(`
        import { useSnapshot } from "valtio";
        function Counter() {
          const snap = useSnapshot(state);
          const current = snap;
          const unused = () => current.count;
          return <span>{snap.count}</span>;
        }
      `),
    ).toBe(0);
  });
});
