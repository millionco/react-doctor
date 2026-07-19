import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireRenderTargetCleanup } from "./three-require-render-target-cleanup.js";

describe("three-require-render-target-cleanup", () => {
  it("reports named, aliased, and namespace render targets without cleanup", () => {
    const code = `
      import { useMemo } from "react";
      import { WebGLRenderTarget as Target, WebGLCubeRenderTarget } from "three";
      import * as THREE from "three";
      function Scene({ size }) {
        const first = useMemo(() => new Target(size, size), [size]);
        const second = useMemo(() => new WebGLCubeRenderTarget(size), [size]);
        const third = useMemo(() => new THREE.RenderTarget(size, size), [size]);
        first.setSize(size, size);
        second.texture.needsUpdate = true;
        third.setSize(size, size);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(3);
  });

  it("reports the real postprocessing destructured memo shape", () => {
    const code = `
      import { useMemo } from "react";
      import { useFrame } from "@react-three/fiber";
      import * as THREE from "three";
      function usePostprocess({ encoding }) {
        const [scene, camera, renderTarget] = useMemo(() => {
          const scene = new THREE.Scene();
          const camera = new THREE.Camera();
          const renderTarget = new THREE.WebGLRenderTarget(512, 512, { encoding });
          scene.background = renderTarget.texture;
          return [scene, camera, renderTarget];
        }, [encoding]);
        useFrame(({ gl }) => {
          gl.setRenderTarget(renderTarget);
          gl.render(scene, camera);
          gl.setRenderTarget(null);
        });
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts exact cleanup through aliases and imported React namespaces", () => {
    const code = `
      import * as React from "react";
      import * as THREE from "three";
      function Scene({ size }) {
        const target = React.useMemo(() => new THREE.WebGLRenderTarget(size, size), [size]);
        const targetAlias = target;
        React.useEffect(() => () => targetAlias.dispose(), [targetAlias]);
        return null;
      }
      function EffectOwned() {
        React.useLayoutEffect(() => {
          const target = new THREE.WebGLRenderTarget(1, 1);
          const cleanup = () => target.dispose();
          return cleanup;
        }, []);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(0);
  });

  it("requires cleanup to follow a reactive target", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { WebGLRenderTarget } from "three";
      function Scene({ size }) {
        const target = useMemo(() => new WebGLRenderTarget(size, size), [size]);
        useEffect(() => () => target.dispose(), []);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts stable memo and lazy-state cleanup with empty dependencies", () => {
    const code = `
      import { useEffect, useMemo, useState } from "react";
      import { WebGLRenderTarget } from "three";
      function Scene() {
        const memoTarget = useMemo(() => new WebGLRenderTarget(1, 1), []);
        const [stateTarget] = useState(() => new WebGLRenderTarget(1, 1));
        useEffect(() => () => { memoTarget.dispose(); stateTarget.dispose(); }, []);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet when ownership or cleanup scheduling escapes local proof", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { WebGLRenderTarget } from "three";
      const moduleTarget = new WebGLRenderTarget(1, 1);
      function useManagedTarget({ dependencies, manager }) {
        const returned = useMemo(() => new WebGLRenderTarget(1, 1), []);
        const managed = useMemo(() => new WebGLRenderTarget(1, 1), []);
        const uncertain = useMemo(() => new WebGLRenderTarget(1, 1), []);
        manager.adopt(managed);
        useEffect(() => () => uncertain.dispose(), dependencies);
        return returned;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(0);
  });

  it("ignores unrelated constructors, shadowing, conditional ownership, and event allocation", () => {
    const code = `
      import { WebGLRenderTarget } from "render-target-library";
      import * as THREE from "three";
      function Scene({ enabled }) {
        const handleClick = () => new THREE.WebGLRenderTarget(1, 1);
        if (enabled) {
          const conditional = new THREE.WebGLRenderTarget(1, 1);
          consume(conditional);
        }
        const THREE = { WebGLRenderTarget };
        const local = new THREE.WebGLRenderTarget(1, 1);
        return <button onClick={handleClick}>{String(local)}</button>;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(0);
  });

  it("supports CommonJS and ignores shadowed require", () => {
    const code = `
      const React = require("react");
      const THREE = require("three");
      function Scene() {
        const target = React.useMemo(() => new THREE.WebGLRenderTarget(1, 1), []);
        return null;
      }
      function Other(require) {
        const LocalThree = require("three");
        const target = new LocalThree.WebGLRenderTarget(1, 1);
        return target;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
  });
});
