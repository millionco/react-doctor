import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoRecursiveRafWithUseFrame } from "./r3f-no-recursive-raf-with-use-frame.js";

describe("r3f-no-recursive-raf-with-use-frame", () => {
  it("reports direct recursive animation frame loops started during render", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updateScene());
          const animate = () => {
            updateOverlay();
            requestAnimationFrame(animate);
          };
          window.requestAnimationFrame(animate);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports recursive loops started by proven React effects", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import * as React from "react";
        import { useFrame as subscribeFrame } from "@react-three/fiber/webgpu";
        const useSceneLoop = () => {
          subscribeFrame(() => updateScene());
          React.useLayoutEffect(() => {
            function animate() {
              updateOverlay();
              globalThis["requestAnimationFrame"](animate);
            }
            requestAnimationFrame(animate);
          }, []);
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports render starts reached through synchronous local helpers", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame } from "@react-three/fiber/native";
        const animate = () => requestAnimationFrame(animate);
        const startRenderLoop = () => window.requestAnimationFrame(animate);
        const useScene = () => {
          useFrame(() => updateScene());
          startRenderLoop();
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports effect starts reached through synchronous local helpers", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useEffect } from "react";
        import { useFrame } from "@react-three/fiber/native";
        const animate = () => requestAnimationFrame(animate);
        const startEffectLoop = () => globalThis.requestAnimationFrame(animate);
        const useScene = () => {
          useFrame(() => updateScene());
          useEffect(() => startEffectLoop(), []);
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a component reaches useFrame through a same-file custom hook", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame } from "@react-three/fiber";
        const useSceneFrame = () => useFrame(() => updateScene());
        const Scene = () => {
          useSceneFrame();
          const animate = () => requestAnimationFrame(animate);
          requestAnimationFrame(animate);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports exact const aliases and transparent wrappers", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import * as Fiber from "@react-three/fiber";
        const Scene = () => {
          const frame = Fiber.useFrame;
          frame(() => updateScene());
          const animate = (() => requestAnimationFrame(animate)) as () => void;
          requestAnimationFrame((animate));
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows one-shot animation frames including demand invalidation", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame, useThree } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updateScene());
          const invalidate = useThree((state) => state.invalidate);
          requestAnimationFrame(() => invalidate());
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows event and deferred callback starts", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useEffect } from "react";
        import { useFrame } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updateScene());
          const animate = () => requestAnimationFrame(animate);
          const onClick = () => requestAnimationFrame(animate);
          useEffect(() => {
            button.addEventListener("click", onClick);
            Promise.resolve().then(() => requestAnimationFrame(animate));
          }, []);
          return <button onClick={onClick}>Start</button>;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows callbacks that do not directly schedule themselves", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updateScene());
          const second = () => requestAnimationFrame(first);
          const first = () => requestAnimationFrame(second);
          const indirect = () => scheduleNextFrame(indirect);
          requestAnimationFrame(first);
          requestAnimationFrame(indirect);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows shadowed animation frame functions and callback bindings", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updateScene());
          const requestAnimationFrame = runOnce;
          const animate = () => requestAnimationFrame(animate);
          requestAnimationFrame(animate);
          const other = () => {
            const animate = renderOnce;
            window.requestAnimationFrame(animate);
          };
          window.requestAnimationFrame(other);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows imported callbacks and components without useFrame", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame } from "@react-three/fiber";
        import { animate } from "./animation";
        const Scene = () => {
          useFrame(() => updateScene());
          requestAnimationFrame(animate);
          return null;
        };
        const Overlay = () => {
          const loop = () => requestAnimationFrame(loop);
          requestAnimationFrame(loop);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows raw Three renderer loops outside React owners", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { WebGLRenderer } from "three";
        const renderer = new WebGLRenderer();
        const animate = () => {
          renderer.render(scene, camera);
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires the R3F v3 capability", () => {
    expect(r3fNoRecursiveRafWithUseFrame.requires).toEqual(["r3f:3"]);
  });
});
