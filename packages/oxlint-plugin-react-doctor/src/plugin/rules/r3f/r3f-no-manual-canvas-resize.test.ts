import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoManualCanvasResize } from "./r3f-no-manual-canvas-resize.js";

describe("r3f-no-manual-canvas-resize", () => {
  it("supports every detected Fiber version", () => {
    expect(r3fNoManualCanvasResize.requires).toBeUndefined();
  });

  it("reports manual window resize loops for selected Canvas renderers", () => {
    const code = `
      import { useEffect } from "react";
      import { useThree } from "@react-three/fiber";
      const Scene = () => {
        const gl = useThree((state) => state.gl);
        const rendererAlias = gl;
        useEffect(() => {
          const resize = () => rendererAlias.setSize(window.innerWidth, window.innerHeight);
          window.addEventListener("resize", resize);
          return () => window.removeEventListener("resize", resize);
        }, [rendererAlias]);
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(1);
  });

  it("tracks whole-state member and destructured renderer access", () => {
    const code = `
      import { useEffect } from "react";
      import { useThree } from "@react-three/fiber";
      const First = () => {
        const state = useThree();
        useEffect(() => {
          window.addEventListener("resize", () => state.gl.setSize(1, 1));
        }, [state]);
      };
      const Second = () => {
        const { gl: renderer } = useThree();
        useEffect(() => {
          const resize = () => renderer.setSize(1, 1);
          window.addEventListener("resize", resize);
        }, [renderer]);
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(2);
  });

  it("tracks WebGPU renderer selectors and local callback chains", () => {
    const code = `
      import { useEffect } from "react";
      import { useThree } from "@react-three/fiber/webgpu";
      const Scene = () => {
        const renderer = useThree((state) => { const selected = state.renderer; return selected; });
        useEffect(() => {
          const updateRenderer = () => renderer.setSize(1, 1);
          const resize = () => updateRenderer();
          window.addEventListener("resize", resize);
        }, [renderer]);
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(1);
  });

  it("reports global onresize assignments and ResizeObserver callbacks", () => {
    const code = `
      import { useThree } from "@react-three/fiber";
      const Scene = () => {
        const gl = useThree((state) => state.gl);
        const resize = () => gl.setSize(window.innerWidth, window.innerHeight);
        window.onresize = resize;
        new ResizeObserver(() => gl.setSize(1, 1));
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(2);
  });

  it("ignores render targets, standalone renderers, non-window targets, and imported handlers", () => {
    const code = `
      import { useEffect } from "react";
      import { WebGLRenderer, WebGLRenderTarget } from "three";
      import { useThree } from "@react-three/fiber";
      import { resize } from "./resize";
      const Scene = ({ element }) => {
        const gl = useThree((state) => state.gl);
        const target = new WebGLRenderTarget();
        const standalone = new WebGLRenderer();
        useEffect(() => {
          window.addEventListener("resize", resize);
          window.addEventListener("scroll", () => gl.setSize(1, 1));
          element.addEventListener("resize", () => gl.setSize(1, 1));
          window.addEventListener("resize", () => target.setSize(1, 1));
          window.addEventListener("resize", () => standalone.setSize(1, 1));
        }, [element, gl, standalone, target]);
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(0);
  });

  it("ignores mutable aliases and shadowed window or useThree bindings", () => {
    const code = `
      import { useThree } from "@react-three/fiber";
      const First = () => {
        let renderer = useThree((state) => state.gl);
        renderer = replacement;
        window.addEventListener("resize", () => renderer.setSize(1, 1));
      };
      const Second = (window) => {
        const gl = useThree((state) => state.gl);
        window.addEventListener("resize", () => gl.setSize(1, 1));
      };
      const Third = (useThree) => {
        const gl = useThree((state) => state.gl);
        window.addEventListener("resize", () => gl.setSize(1, 1));
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(0);
  });

  it("ignores shadowed resize observers, non-assignment writes, and unresolved handlers", () => {
    const code = `
      import { resize } from "./resize";
      import { useThree } from "@react-three/fiber";
      const First = (ResizeObserver) => {
        const gl = useThree((state) => state.gl);
        new ResizeObserver(() => gl.setSize(1, 1));
      };
      const Second = () => {
        const gl = useThree((state) => state.gl);
        window.onresize += () => gl.setSize(1, 1);
        window.onresize = resize;
      };
    `;
    expect(runRule(r3fNoManualCanvasResize, code).diagnostics).toHaveLength(0);
  });
});
