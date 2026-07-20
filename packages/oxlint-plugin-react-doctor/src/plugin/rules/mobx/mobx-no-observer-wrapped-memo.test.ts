import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxNoObserverWrappedMemo } from "./mobx-no-observer-wrapped-memo.js";

const diagnosticsFor = (
  source: string,
  capabilities: ReadonlyArray<string> = [
    "mobx-react-observer-memo-guard",
    "mobx-react-lite-observer-memo-guard",
  ],
): number =>
  runRule(mobxNoObserverWrappedMemo, source, {
    settings: { "react-doctor": { capabilities } },
  }).diagnostics.length;

describe("mobx-no-observer-wrapped-memo", () => {
  it("reports observer wrapping named, namespace, and default React memo calls", () => {
    expect(
      diagnosticsFor(`
        import React, { memo } from "react";
        import { observer } from "mobx-react-lite";
        observer(memo(Profile));
        observer(React.memo(Settings));
      `),
    ).toBe(2);
  });

  it("reports both official observer packages and double observer", () => {
    expect(
      diagnosticsFor(`
        import { observer as liteObserver } from "mobx-react-lite";
        import * as mobxReact from "mobx-react";
        liteObserver(liteObserver(Profile));
        mobxReact.observer(mobxReact.observer(Settings));
      `),
    ).toBe(2);
  });

  it("checks each observer import against its own binding version capability", () => {
    const source = `
      import { memo } from "react";
      import { observer as legacyObserver } from "mobx-react";
      import { observer as liteObserver } from "mobx-react-lite";
      legacyObserver(memo(LegacyProfile));
      liteObserver(memo(Profile));
    `;
    expect(diagnosticsFor(source, ["mobx-react-lite-observer-memo-guard"])).toBe(1);
    expect(diagnosticsFor(source, ["mobx-react-observer-memo-guard"])).toBe(1);
  });

  it("reports same-file immutable wrapper results and aliases", () => {
    expect(
      diagnosticsFor(`
        import { memo } from "react";
        import { observer } from "mobx-react-lite";
        const observe = observer;
        const MemoProfile = memo(Profile);
        const Alias = MemoProfile;
        observe(Alias);
      `),
    ).toBe(1);
  });

  it("reports wrappers destructured from exact namespaces", () => {
    expect(
      diagnosticsFor(`
        import * as React from "react";
        import * as mobxReact from "mobx-react-lite";
        const { memo: cache } = React;
        const { observer: observe } = mobxReact;
        observe(cache(Profile));
      `),
    ).toBe(1);
  });

  it("accepts supported outer memo and inner forwardRef order", () => {
    expect(
      diagnosticsFor(`
        import { forwardRef, memo } from "react";
        import { observer } from "mobx-react-lite";
        memo(observer(Profile));
        observer(forwardRef(Input));
        observer(Input, { forwardRef: true });
      `),
    ).toBe(0);
  });

  it("does not infer imported custom wrappers from their names", () => {
    expect(
      diagnosticsFor(`
        import { MemoProfile, observer as customObserver } from "./wrappers";
        import { observer } from "mobx-react-lite";
        observer(MemoProfile);
        customObserver(MemoProfile);
      `),
    ).toBe(0);
  });

  it("does not report shadowed or mutable wrapper aliases", () => {
    expect(
      diagnosticsFor(`
        import { memo } from "react";
        import { observer } from "mobx-react-lite";
        let observe = observer;
        observe = customObserver;
        function build(observer, memo) {
          observer(memo(Profile));
        }
        observe(memo(Profile));
      `),
    ).toBe(0);
  });

  it("handles transparent TypeScript wrappers without widening provenance", () => {
    expect(
      diagnosticsFor(`
        import { memo } from "react";
        import { observer } from "mobx-react-lite";
        (observer as typeof observer)((memo as typeof memo)(Profile));
      `),
    ).toBe(1);
    expect(
      diagnosticsFor(`
        import { memo } from "./custom";
        import { observer } from "mobx-react-lite";
        observer((memo as typeof memo)(Profile));
      `),
    ).toBe(0);
  });
});
