import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectEventInDeps } from "./no-effect-event-in-deps.js";

const runTsx = (code: string) => runRule(noEffectEventInDeps, code, { filename: "fixture.tsx" });

describe("no-effect-event-in-deps — regressions: same-named non-React useEffectEvent", () => {
  it("does not flag a useEffectEvent imported from a non-React package listed in deps", () => {
    const result = runTsx(`
      import { useEffect } from "react";
      import { useEffectEvent } from "@rocket.chat/fuselage-hooks";
      const MyComponent = ({ value }) => {
        const onTick = useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags React's useEffectEvent listed in deps", () => {
    const result = runTsx(`
      import { useEffect, useEffectEvent } from "react";
      const MyComponent = ({ value }) => {
        const onTick = useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      'Listing "onTick" in the deps defeats useEffectEvent — Effect Events are non-reactive and must be omitted from deps.',
    );
  });

  it("does not flag a useEffectEvent polyfill DEFINED in the same module listed in deps (its result is a stable callback)", () => {
    const result = runTsx(`
      import { useCallback, useEffect, useRef } from "react";
      const useEffectEvent = (callback) => {
        const ref = useRef(callback);
        ref.current = callback;
        return useCallback((...args) => ref.current(...args), []);
      };
      const MyComponent = ({ value }) => {
        const onTick = useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a bare/unimported useEffectEvent listed in deps (parity)", () => {
    const result = runTsx(`
      import { useEffect } from "react";
      const MyComponent = ({ value }) => {
        const onTick = useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  // fuzz edge-case wave: the polyfill origin spelled as a member access —
  // `Utils.useEffectEvent(...)` through a namespace imported from a
  // non-React package returns a stable callback just like the named import.
  it("does not flag a namespace-imported polyfill (FloatingUI.useEffectEvent) listed in deps", () => {
    const result = runTsx(`
      import { useEffect } from "react";
      import * as FloatingUI from "@floating-ui/react/utils";
      const MyComponent = ({ value }) => {
        const onTick = FloatingUI.useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a lowercase namespace polyfill (utils.useEffectEvent) listed in deps", () => {
    const result = runTsx(`
      import { useEffect } from "react";
      import * as utils from "@floating-ui/react/utils";
      const MyComponent = ({ value }) => {
        const onTick = utils.useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags React.useEffectEvent through the React namespace listed in deps", () => {
    const result = runTsx(`
      import * as React from "react";
      const MyComponent = ({ value }) => {
        const onTick = React.useEffectEvent(() => value);
        React.useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a hoisted function-declaration polyfill defined BELOW the component", () => {
    const result = runTsx(`
      import { useCallback, useEffect, useRef } from "react";
      const MyComponent = ({ value }) => {
        const onTick = useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
      function useEffectEvent(callback) {
        const ref = useRef(callback);
        ref.current = callback;
        return useCallback((...args) => ref.current(...args), []);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a component-local shadow even when React's useEffectEvent is imported", () => {
    const result = runTsx(`
      import { useEffect, useEffectEvent } from "react";
      import { makePolyfill } from "./make-polyfill";
      const MyComponent = ({ value }) => {
        const useEffectEvent = makePolyfill();
        const onTick = useEffectEvent(() => value);
        useEffect(() => { onTick(); }, [onTick]);
        return null;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
