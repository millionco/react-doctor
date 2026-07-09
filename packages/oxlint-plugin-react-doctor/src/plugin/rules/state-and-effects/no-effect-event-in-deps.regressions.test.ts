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
      'Listing "onTick" in the deps re-runs your effect every render & defeats useEffectEvent.',
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
});
