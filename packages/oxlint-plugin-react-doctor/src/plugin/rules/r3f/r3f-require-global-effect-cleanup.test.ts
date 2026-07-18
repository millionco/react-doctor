import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireGlobalEffectCleanup } from "./r3f-require-global-effect-cleanup.js";

describe("r3f-require-global-effect-cleanup", () => {
  it("reports discarded registrations in React effects", () => {
    const code = `
      import { useEffect, useLayoutEffect } from "react";
      import { addEffect, addAfterEffect, addTail } from "@react-three/fiber";
      function Scene({ callback }) {
        useEffect(() => { addEffect(callback); }, [callback]);
        useLayoutEffect(() => { addAfterEffect(callback); addTail(callback); }, [callback]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows direct returns and exact captured disposer cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect, addAfterEffect, addTail } from "@react-three/fiber/native";
      function Scene({ callback }) {
        useEffect(() => addEffect(callback), [callback]);
        useEffect(() => { const dispose = addAfterEffect(callback); return () => dispose(); }, [callback]);
        useEffect(() => { const dispose = addTail(callback); return dispose; }, [callback]);
        useEffect(() => {
          const disposeEffect = addEffect(callback);
          const disposeTail = addTail(callback);
          const cleanup = () => { disposeEffect(); disposeTail(); };
          return cleanup;
        }, [callback]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a registration returned as the final sequence value", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect, addTail } from "@react-three/fiber";
      function Scene({ callback }) {
        useEffect(() => (prepare(), addEffect(callback)), [callback]);
        useEffect(() => { return (prepare(), addTail(callback)); }, [callback]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows registrations that only execute on a directly returned branch", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect, addTail } from "@react-three/fiber";
      function Scene({ callback, enabled }) {
        useEffect(() => { if (enabled) return addEffect(callback); }, [callback, enabled]);
        useEffect(() => enabled ? addTail(callback) : undefined, [callback, enabled]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("correlates every captured disposer independently", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect, addTail } from "@react-three/fiber";
      function Scene({ callback }) {
        useEffect(() => {
          const disposeEffect = addEffect(callback);
          const disposeTail = addTail(callback);
          return () => disposeEffect();
        }, [callback]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires every effect return path to clean up each registration", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect, addTail } from "@react-three/fiber";
      function Scene({ callback, enabled }) {
        useEffect(() => {
          const disposeEffect = addEffect(callback);
          if (enabled) return disposeEffect;
          return () => {};
        }, [callback, enabled]);
        useEffect(() => {
          const disposeEffect = addEffect(callback);
          const disposeTail = addTail(callback);
          return enabled ? disposeEffect : disposeTail;
        }, [callback, enabled]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports registrations in deferred effect work", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect } from "@react-three/fiber";
      function Scene({ callback, ready }) {
        useEffect(() => { ready.then(() => { addEffect(callback); }); }, [callback, ready]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat nested returns as effect cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect, addTail } from "@react-three/fiber";
      function Scene({ callback, ready }) {
        const registerTail = () => addTail(callback);
        useEffect(() => {
          ready.then(() => { return addEffect(callback); });
          registerTail();
        }, [callback, ready]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows an effect to return a local registration helper", () => {
    const code = `
      import { useEffect } from "react";
      import { addTail } from "@react-three/fiber";
      function Scene({ callback }) {
        const registerTail = () => addTail(callback);
        useEffect(() => registerTail(), [callback]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a deferred disposer assigned for returned cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { addEffect } from "@react-three/fiber";
      function Scene({ callback, ready }) {
        useEffect(() => {
          let dispose;
          ready.then(() => { dispose = addEffect(callback); });
          return () => dispose?.();
        }, [callback, ready]);
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports registration during render and in useFrame", () => {
    const code = `
      import { addEffect, addTail, useFrame } from "@react-three/fiber/webgpu";
      function Scene({ callback }) {
        addEffect(callback);
        useFrame(() => { addTail(callback); });
        return null;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores module lifetime, unrelated imports, and event handlers", () => {
    const code = `
      import { addEffect } from "@react-three/fiber";
      import { addEffect as addOtherEffect } from "scheduler";
      const disposeModuleEffect = addEffect(globalCallback);
      function Scene({ callback }) {
        const handleClick = () => addEffect(callback);
        addOtherEffect(callback);
        return <button onClick={handleClick} />;
      }
    `;
    const result = runRule(r3fRequireGlobalEffectCleanup, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
