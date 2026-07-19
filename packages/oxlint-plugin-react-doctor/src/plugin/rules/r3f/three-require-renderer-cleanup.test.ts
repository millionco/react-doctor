import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireRendererCleanup } from "./three-require-renderer-cleanup.js";

describe("three-require-renderer-cleanup", () => {
  it("reports WebGL and WebGPU renderers without disposal", () => {
    const code = `
      import { useEffect } from "react";
      import { WebGLRenderer as Renderer } from "three";
      import * as THREE from "three/webgpu";
      function First({ canvas }) {
        useEffect(() => {
          const renderer = new Renderer({ canvas });
          renderer.render(scene, camera);
        }, [canvas]);
        return null;
      }
      function Second({ canvas }) {
        useEffect(() => {
          const renderer = new THREE.WebGPURenderer({ canvas });
          renderer.renderAsync(scene, camera);
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(2);
  });

  it("accepts exact dispose cleanup through an alias", () => {
    const code = `
      import { useEffect } from "react";
      import * as THREE from "three";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new THREE.WebGLRenderer({ canvas });
          const rendererAlias = renderer;
          renderer.render(scene, camera);
          return () => rendererAlias.dispose();
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(0);
  });

  it("requires setAnimationLoop to be stopped before cleanup", () => {
    const missingStop = `
      import { useEffect } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          renderer.setAnimationLoop(() => renderer.render(scene, camera));
          return () => renderer.dispose();
        }, [canvas]);
        return null;
      }
    `;
    const complete = `
      import { useEffect } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          renderer.setAnimationLoop(() => renderer.render(scene, camera));
          return () => { renderer.setAnimationLoop(null); renderer.dispose(); };
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, missingStop).diagnostics).toHaveLength(1);
    expect(runRule(threeRequireRendererCleanup, complete).diagnostics).toHaveLength(0);
  });

  it("requires the current animation frame handle to be canceled", () => {
    const missingCancel = `
      import { useEffect } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          let frame;
          const animate = () => {
            frame = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => renderer.dispose();
        }, [canvas]);
        return null;
      }
    `;
    const complete = `
      import { useEffect } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          let frame;
          const animate = () => {
            frame = window.requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => { window.cancelAnimationFrame(frame); renderer.dispose(); };
        }, [canvas]);
        return null;
      }
    `;
    const missingAsyncCancel = `
      import { useEffect } from "react";
      import { WebGPURenderer } from "three/webgpu";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new WebGPURenderer({ canvas });
          let frame;
          const animate = () => {
            frame = requestAnimationFrame(animate);
            renderer.renderAsync(scene, camera);
          };
          animate();
          return () => renderer.dispose();
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, missingCancel).diagnostics).toHaveLength(1);
    expect(runRule(threeRequireRendererCleanup, complete).diagnostics).toHaveLength(0);
    expect(runRule(threeRequireRendererCleanup, missingAsyncCancel).diagnostics).toHaveLength(1);
  });

  it("does not associate unrelated animation frames with a renderer", () => {
    const code = `
      import { useEffect } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          const unrelated = () => requestAnimationFrame(unrelated);
          const renderOnce = () => renderer.render(scene, camera);
          unrelated();
          renderOnce();
          return () => renderer.dispose();
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(0);
  });

  it("accepts reactive memo cleanup only when dependencies follow the renderer", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { WebGLRenderer } from "three";
      function Missing({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        useEffect(() => () => renderer.dispose(), []);
        return null;
      }
      function Complete({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        useEffect(() => () => renderer.dispose(), [renderer]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
  });

  it("leaves renderers supplied to R3F Canvas under R3F ownership", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { useMemo } from "react";
      import { WebGLRenderer } from "three";
      function Direct({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        return <Canvas gl={renderer} />;
      }
      function Factory({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        return <Canvas gl={() => renderer} />;
      }
      function BlockFactory({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        return <Canvas gl={() => { return renderer; }} />;
      }
      function NamedFactory({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        const makeRenderer = () => renderer;
        return <Canvas gl={makeRenderer} />;
      }
      function ConfigOnly({ canvas }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        return <Canvas gl={{ canvas: renderer.domElement }} />;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
  });

  it("recognizes renderer ownership only on the WebGPU Canvas entry point", () => {
    const code = `
      import { Canvas as WebGpuCanvas } from "@react-three/fiber/webgpu";
      import { useMemo } from "react";
      import { WebGPURenderer } from "three/webgpu";
      function WebGpuDirect({ canvas }) {
        const renderer = useMemo(() => new WebGPURenderer({ canvas }), [canvas]);
        return <WebGpuCanvas renderer={renderer} />;
      }
      function WebGpuFactory({ canvas }) {
        const renderer = useMemo(() => new WebGPURenderer({ canvas }), [canvas]);
        return <WebGpuCanvas renderer={() => renderer} />;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(0);
  });

  it("requires every Canvas renderer factory branch to transfer the owned renderer", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { useMemo } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas, shouldUseOwnedRenderer }) {
        const renderer = useMemo(() => new WebGLRenderer({ canvas }), [canvas]);
        const makeRenderer = () => {
          if (shouldUseOwnedRenderer) return renderer;
          return new WebGLRenderer({ canvas });
        };
        return <Canvas gl={makeRenderer} />;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
  });

  it("stays quiet for module, returned, managed, unrelated, and shadowed renderers", () => {
    const code = `
      import { WebGLRenderer } from "three";
      import { WebGLRenderer as OtherRenderer } from "renderer-library";
      const moduleRenderer = new WebGLRenderer();
      function useRenderer(manager) {
        const returned = new WebGLRenderer();
        const managed = new WebGLRenderer();
        const unrelated = new OtherRenderer();
        manager.adopt(managed);
        return returned;
      }
      function Scene(WebGLRenderer) {
        const renderer = new WebGLRenderer();
        return renderer;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(0);
  });

  it("supports CommonJS and ignores shadowed require", () => {
    const code = `
      const React = require("react");
      const THREE = require("three");
      function Scene({ canvas }) {
        React.useEffect(() => {
          const renderer = new THREE.WebGLRenderer({ canvas });
          renderer.render(scene, camera);
        }, [canvas]);
        return null;
      }
      function Other(require) {
        const LocalThree = require("three");
        const renderer = new LocalThree.WebGLRenderer();
        return renderer;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
  });
});
