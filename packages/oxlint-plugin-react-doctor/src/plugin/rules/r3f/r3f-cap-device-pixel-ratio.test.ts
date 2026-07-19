import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fCapDevicePixelRatio } from "./r3f-cap-device-pixel-ratio.js";

describe("r3f-cap-device-pixel-ratio", () => {
  it("reports raw DPR on imported and namespace Canvas components", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { Canvas as SceneCanvas } from "@react-three/fiber";
        import * as Fiber from "@react-three/fiber";
        const rawDpr = window.devicePixelRatio;
        const App = () => <><SceneCanvas dpr={rawDpr} /><Fiber.Canvas dpr={globalThis["devicePixelRatio"]} /></>;
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports an uncapped raw upper bound in a DPR range", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { Canvas } from "@react-three/fiber";
        const dprRange = [1, window.devicePixelRatio] as const;
        const App = () => <><Canvas dpr={[1, globalThis.devicePixelRatio]} /><Canvas dpr={dprRange} /></>;
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports legacy pixelRatio props and destructured or derived raw DPR", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { Canvas } from "react-three-fiber";
        const { devicePixelRatio: rawDpr } = window;
        const scaledDpr = rawDpr * 0.75;
        const App = () => <><Canvas pixelRatio={scaledDpr} /><Canvas dpr={+globalThis.devicePixelRatio} /></>;
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports direct and lazy-state createRoot configuration", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { createRoot } from "@react-three/fiber";
        import { useState } from "react";
        const directRoot = createRoot(canvas);
        directRoot.configure({ dpr: window.devicePixelRatio });
        const Hook = () => {
          const [{ root }] = useState(() => {
            const root = createRoot(canvas);
            return { root };
          });
          root.configure({ dpr: globalThis.devicePixelRatio, ...props });
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports proven Three.js renderer setPixelRatio calls", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { WebGLRenderer as Renderer } from "three";
        import * as THREE from "three/webgpu";
        const renderer = new Renderer();
        const rendererAlias = renderer;
        rendererAlias.setPixelRatio(window.devicePixelRatio);
        new THREE.WebGPURenderer()["setPixelRatio"](globalThis.devicePixelRatio);
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports selector and destructured useThree setDpr calls", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { useThree } from "@react-three/fiber";
        const Scene = () => {
          const selectedSetDpr = useThree((state) => state.setDpr);
          const { setDpr: storeSetDpr } = useThree();
          selectedSetDpr(window.devicePixelRatio);
          storeSetDpr(globalThis.devicePixelRatio);
          return null;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows capped expressions, ranges, constants, and configuration values", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { Canvas, createRoot } from "@react-three/fiber";
        import { WebGLRenderer } from "three";
        const renderer = new WebGLRenderer();
        const root = createRoot(canvas);
        const App = ({ configuredDpr }) => <>
          <Canvas dpr={Math.min(window.devicePixelRatio, 2)} />
          <Canvas dpr={[1, 2]} />
          <Canvas dpr={[window.devicePixelRatio, 2]} />
          <Canvas dpr={[1, Math.min(window.devicePixelRatio, 2)]} />
          <Canvas dpr={2} />
          <Canvas dpr={configuredDpr} />
          <Canvas dpr={window.devicePixelRatio * 0} />
          <Canvas dpr={2 / window.devicePixelRatio} />
          <Canvas dpr={2 - window.devicePixelRatio} />
          <Canvas dpr={window.devicePixelRatio ** 0} />
          <Canvas dpr={-window.devicePixelRatio} />
          <Canvas pixelRatio={Math.min(window.devicePixelRatio, 2)} />
        </>;
        root.configure({ dpr: Math.min(globalThis.devicePixelRatio, 2) });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores custom Canvas and unknown renderer or setter ownership", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { Canvas as FiberCanvas } from "@react-three/fiber";
        import { Canvas } from "design-system";
        const App = ({ renderer, setDpr, store }) => <Canvas dpr={window.devicePixelRatio} />;
        renderer.setPixelRatio(window.devicePixelRatio);
        setDpr(window.devicePixelRatio);
        store.getState().setDpr(window.devicePixelRatio);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores shadowed browser globals and shadowed library APIs", () => {
    const result = runRule(
      r3fCapDevicePixelRatio,
      `
        import { Canvas, createRoot } from "@react-three/fiber";
        const App = ({ window, globalThis, createRoot }) => {
          const root = createRoot(canvas);
          root.configure({ dpr: window.devicePixelRatio });
          return <Canvas dpr={globalThis.devicePixelRatio} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
