import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoExtendInRender } from "./r3f-no-extend-in-render.js";

describe("r3f-no-extend-in-render", () => {
  it("supports every detected Fiber version", () => {
    expect(r3fNoExtendInRender.requires).toBeUndefined();
  });

  it("reports direct and render-time initializer registrations", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        import { useMemo, useState } from "react";
        const Scene = () => {
          extend({ CustomObject });
          useMemo(() => extend({ MemoObject }), []);
          useState(() => extend({ StateObject }));
          return <customObject />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves renamed, namespace, CommonJS, and import-equals APIs", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend as register } from "@react-three/fiber/native";
        import * as Fiber from "@react-three/fiber/webgpu";
        const CommonJsFiber = require("@react-three/fiber");
        import LegacyFiber = require("react-three-fiber");
        const NativeScene = () => { register({ NativeObject }); return null; };
        const WebGpuScene = () => { Fiber.extend({ WebGpuObject }); return null; };
        const CommonJsScene = () => { CommonJsFiber.extend({ CommonJsObject }); return null; };
        const LegacyScene = () => { LegacyFiber.extend({ LegacyObject }); return null; };
      `,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("allows module-scope registration and deferred callbacks", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        import { useEffect } from "react";
        extend({ ModuleObject });
        const Scene = () => {
          useEffect(() => extend({ EffectObject }), []);
          const onClick = () => extend({ EventObject });
          return <mesh onClick={onClick} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows render-time registration protected by a module cache", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        const components = new WeakMap();
        const wrap = (effect) => function Effect() {
          let Component = components.get(effect);
          if (!Component) {
            const key = \`effect-\${effect.name}\`;
            extend({ [key]: effect });
            components.set(effect, (Component = key));
          }
          return <Component />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows module-cache registration in the falsy branch of a positive guard", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        const components = new WeakMap();
        const wrap = (effect) => function Effect() {
          let Component = components.get(effect);
          if (Component) {
            return <Component />;
          } else {
            const key = \`effect-\${effect.name}\`;
            extend({ [key]: effect });
            components.set(effect, (Component = key));
          }
          return <Component />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a render-time registration when the cache remains empty", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        const components = new WeakMap();
        const wrap = (effect) => function Effect() {
          let Component = components.get(effect);
          if (!Component) {
            extend({ Effect: effect });
            components.set(effect, (Component = null));
          }
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports module-cache registration in the truthy branch of a positive guard", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        const components = new WeakMap();
        const wrap = (effect) => function Effect() {
          let Component = components.get(effect);
          if (Component) {
            extend({ Effect: effect });
            components.set(effect, (Component = "effect"));
          }
          return <Component />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores shadowed, reassigned, and unrelated extend functions", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend as importedExtend } from "@react-three/fiber";
        import { extend } from "other-renderer";
        importedExtend = replacement;
        const FirstScene = () => { importedExtend({ Object }); return null; };
        const SecondScene = () => { extend({ Object }); return null; };
        const ThirdScene = () => { const importedExtend = localExtend; importedExtend({ Object }); return null; };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat arbitrary nested callbacks as render execution", () => {
    const result = runRule(
      r3fNoExtendInRender,
      `
        import { extend } from "@react-three/fiber";
        const Scene = () => {
          Promise.resolve().then(() => extend({ DeferredObject }));
          return <mesh />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
