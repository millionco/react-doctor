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

  it("reports eager useRef-owned renderers even with cleanup through current aliases", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Missing() {
        const rendererRef = useRef(new WebGLRenderer());
        rendererRef.current.render(scene, camera);
        return null;
      }
      function Complete() {
        const rendererRef = useRef(new WebGLRenderer());
        const renderer = rendererRef.current;
        renderer.render(scene, camera);
        useEffect(() => () => renderer.dispose(), []);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(2);
  });

  it("tracks guarded lazy useRef renderer assignment", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Missing() {
        const rendererRef = useRef(null);
        if (!rendererRef.current) {
          rendererRef.current = new WebGLRenderer();
        }
        rendererRef.current.render(scene, camera);
        return null;
      }
      function Complete() {
        const rendererRef = useRef(null);
        if (!rendererRef.current) rendererRef.current = new WebGLRenderer();
        rendererRef.current.render(scene, camera);
        useEffect(() => () => rendererRef.current.dispose(), []);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
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

  it("retains ownership when an effect stores the renderer in an otherwise-unused local ref", () => {
    const missingCancel = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        const rendererRef = useRef(null);
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          rendererRef.current = renderer;
          const animate = () => {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => renderer.dispose();
        }, [canvas]);
        return null;
      }
    `;
    const escapingRef = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas, publish }) {
        const rendererRef = useRef(null);
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          rendererRef.current = renderer;
          publish(rendererRef);
          const animate = () => {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => renderer.dispose();
        }, [canvas, publish]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, missingCancel).diagnostics).toHaveLength(1);
    expect(runRule(threeRequireRendererCleanup, escapingRef).diagnostics).toHaveLength(0);
  });

  it("retains ownership when the local ref is read and cleared", () => {
    const missingCancel = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        const rendererRef = useRef(null);
        useEffect(() => {
          if (rendererRef.current) return;
          const renderer = new WebGLRenderer({ canvas });
          rendererRef.current = renderer;
          const animate = () => {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => {
            renderer.dispose();
            rendererRef.current = null;
          };
        }, [canvas]);
        return null;
      }
    `;
    const complete = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        const rendererRef = useRef(null);
        useEffect(() => {
          if (rendererRef.current) return;
          const renderer = new WebGLRenderer({ canvas });
          rendererRef.current = renderer;
          let frameId;
          const animate = () => {
            frameId = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => {
            cancelAnimationFrame(frameId);
            renderer.dispose();
            rendererRef.current = null;
          };
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, missingCancel).diagnostics).toHaveLength(1);
    expect(runRule(threeRequireRendererCleanup, complete).diagnostics).toHaveLength(0);
  });

  it("retains ownership when the component stores the renderer in an otherwise-unused local ref", () => {
    const code = `
      import { useRef } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        const rendererRef = useRef(null);
        const renderer = new WebGLRenderer({ canvas });
        rendererRef.current = renderer;
        renderer.render(scene, camera);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts animation frame handles stored in the same stable React ref", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Scene({ canvas }) {
        const frameRef = useRef(null);
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          const animate = () => {
            frameRef.current = window.requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => {
            window.cancelAnimationFrame(frameRef.current);
            renderer.dispose();
          };
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(0);
  });

  it("allows renderer and animation frame cleanup after pre-allocation returns", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import * as THREE from "three";
      function CameraPreviewPanel({ isVisible, mainScene }) {
        const canvasRef = useRef(null);
        useEffect(() => {
          if (!canvasRef.current || !isVisible) return;
          if (!mainScene) return;
          const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current });
          let frameId;
          const animate = () => {
            frameId = requestAnimationFrame(animate);
            renderer.render(mainScene, camera);
          };
          animate();
          return () => {
            cancelAnimationFrame(frameId);
            renderer.dispose();
          };
        }, [isVisible, mainScene]);
        return <canvas ref={canvasRef} />;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(0);
  });

  it("reports renderer and animation frame cleanup gaps after allocation", () => {
    const code = `
      import { useEffect } from "react";
      import { WebGLRenderer } from "three";
      function CameraPreviewPanel({ canvas, isVisible, skipCleanup }) {
        useEffect(() => {
          if (!canvas || !isVisible) return;
          const renderer = new WebGLRenderer({ canvas });
          let frameId;
          const animate = () => {
            frameId = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          if (skipCleanup) return;
          return () => {
            cancelAnimationFrame(frameId);
            renderer.dispose();
          };
        }, [canvas, isVisible, skipCleanup]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(1);
  });

  it("rejects mismatched, overwritten, and non-React ref animation frame handles", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderer } from "three";
      function Mismatched({ canvas }) {
        const frameRef = useRef(null);
        const otherFrameRef = useRef(null);
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          const animate = () => {
            frameRef.current = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => {
            cancelAnimationFrame(otherFrameRef.current);
            renderer.dispose();
          };
        }, [canvas]);
        return null;
      }
      function Overwritten({ canvas }) {
        const frameRef = useRef(null);
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          const animate = () => {
            frameRef.current = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          frameRef.current = requestAnimationFrame(renderOverlay);
          return () => {
            cancelAnimationFrame(frameRef.current);
            renderer.dispose();
          };
        }, [canvas]);
        return null;
      }
      function Replaced({ canvas }) {
        const frameRef = useRef(null);
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          const animate = () => {
            frameRef.current = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          frameRef.current = replacementHandle;
          return () => {
            cancelAnimationFrame(frameRef.current);
            renderer.dispose();
          };
        }, [canvas]);
        return null;
      }
      function NonReactRef({ canvas }) {
        const frameRef = { current: null };
        useEffect(() => {
          const renderer = new WebGLRenderer({ canvas });
          const animate = () => {
            frameRef.current = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          };
          animate();
          return () => {
            cancelAnimationFrame(frameRef.current);
            renderer.dispose();
          };
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(threeRequireRendererCleanup, code).diagnostics).toHaveLength(4);
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
      import { useMemo, useRef } from "react";
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
      function RefDirect({ canvas }) {
        const rendererRef = useRef(new WebGLRenderer({ canvas }));
        return <Canvas gl={rendererRef.current} />;
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

  it("does not claim parameter, imported, shared, or shadowed refs", () => {
    const code = `
      import { useRef } from "react";
      import { sharedRendererRef } from "./renderer";
      import { WebGLRenderer } from "three";
      const moduleRef = { current: null };
      function ParameterRef({ rendererRef }) {
        if (!rendererRef.current) rendererRef.current = new WebGLRenderer();
        return null;
      }
      function ImportedRef() {
        if (!sharedRendererRef.current) sharedRendererRef.current = new WebGLRenderer();
        return null;
      }
      function SharedRef() {
        if (!moduleRef.current) moduleRef.current = new WebGLRenderer();
        return null;
      }
      function ShadowedRef({ useRef }) {
        const rendererRef = useRef(null);
        if (!rendererRef.current) rendererRef.current = new WebGLRenderer();
        return null;
      }
      function UnguardedRef() {
        const rendererRef = useRef(null);
        rendererRef.current = new WebGLRenderer();
        return null;
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
