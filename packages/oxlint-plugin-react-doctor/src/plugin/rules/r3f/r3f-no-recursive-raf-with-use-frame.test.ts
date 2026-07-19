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

  it("reports setAnimationLoop on the useThree renderer even when cleanup clears it", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useCallback, useEffect } from "react";
        import { useFrame, useThree } from "@react-three/fiber";
        const Scene = () => {
          useFrame(() => updateScene());
          const gl = useThree((state) => state.gl);
          const renderOverlay = useCallback(() => gl.render(overlayScene, camera), [gl]);
          useEffect(() => {
            gl.setAnimationLoop(renderOverlay);
            return () => gl.setAnimationLoop(null);
          }, [gl, renderOverlay]);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports imported setAnimationLoop callbacks", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useEffect } from "react";
        import { useFrame, useThree } from "@react-three/fiber";
        import renderOverlay from "./render-overlay";
        import { animate as renderImportedScene } from "./animation";
        import * as importedLoops from "./loops";
        const aliasedImportedLoop = renderImportedScene;
        const Scene = () => {
          useFrame(() => updateScene());
          const gl = useThree((state) => state.gl);
          useEffect(() => {
            gl.setAnimationLoop(renderImportedScene);
            gl.setAnimationLoop(renderOverlay);
            gl.setAnimationLoop(importedLoops.renderScene);
            gl.setAnimationLoop(aliasedImportedLoop);
            return () => gl.setAnimationLoop(null);
          }, [gl]);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports destructured and renderer-named useThree scheduling", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame, useThree } from "@react-three/fiber/webgpu";
        const First = () => {
          useFrame(() => updateScene());
          const { gl } = useThree();
          gl.setAnimationLoop(() => gl.render(scene, camera));
          return null;
        };
        const Second = () => {
          useFrame(() => updateScene());
          const renderer = useThree((state) => state.renderer);
          renderer.setAnimationLoop(() => renderer.renderAsync(scene, camera));
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
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

  it("allows cleared, locally owned, unrelated, and non-R3F renderer loops", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame, useThree } from "@react-three/fiber";
        import { WebGLRenderer } from "three";
        const Scene = ({ unrelated }) => {
          useFrame(() => updateScene());
          const gl = useThree((state) => state.gl);
          const localRenderer = new WebGLRenderer();
          gl.setAnimationLoop(null);
          localRenderer.setAnimationLoop(() => localRenderer.render(scene, camera));
          unrelated.setAnimationLoop(() => updateOverlay());
          return null;
        };
        const Independent = () => {
          const gl = useThree((state) => state.gl);
          gl.setAnimationLoop(() => gl.render(scene, camera));
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows nullish and unresolved setAnimationLoop callback values", () => {
    const result = runRule(
      r3fNoRecursiveRafWithUseFrame,
      `
        import { useFrame, useThree } from "@react-three/fiber";
        const Scene = ({ callback }) => {
          useFrame(() => updateScene());
          const gl = useThree((state) => state.gl);
          let mutableCallback = callback;
          const unknownCallback = getAnimationLoop();
          gl.setAnimationLoop(null);
          gl.setAnimationLoop(undefined);
          gl.setAnimationLoop(callback);
          gl.setAnimationLoop(mutableCallback);
          gl.setAnimationLoop(unknownCallback);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports every detected Fiber version", () => {
    expect(r3fNoRecursiveRafWithUseFrame.requires).toBeUndefined();
  });
});
