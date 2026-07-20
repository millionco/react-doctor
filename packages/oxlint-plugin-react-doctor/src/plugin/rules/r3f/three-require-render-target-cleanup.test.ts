import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  LIFECYCLE_ANALYSIS_DENSE_EFFECT_COUNT,
  LIFECYCLE_ANALYSIS_LARGE_ALLOCATION_COUNT,
} from "./constants.js";
import { threeRequireRenderTargetCleanup } from "./three-require-render-target-cleanup.js";

const lifecycleCleanupMethodCounter = vi.hoisted(() => vi.fn());

vi.mock("./utils/analyze-owned-lifecycle-resource.js", async (importOriginal) => {
  const originalModule =
    await importOriginal<typeof import("./utils/analyze-owned-lifecycle-resource.js")>();
  return {
    ...originalModule,
    functionInvokesOwnedResourceMethod: lifecycleCleanupMethodCounter.mockImplementation(
      originalModule.functionInvokesOwnedResourceMethod,
    ),
  };
});

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

  it("accepts immediate disposal after the render target is used", () => {
    const code = `
      import { useEffect } from "react";
      import { WebGLCubeRenderTarget } from "three";
      function Preload({ camera, gl, scene }) {
        useEffect(() => {
          const target = new WebGLCubeRenderTarget(128);
          camera.update(gl, scene, target);
          target.dispose();
        }, []);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(0);
  });

  it("rejects immediate disposal that remains conditional", () => {
    const code = `
      import { useEffect } from "react";
      import { WebGLRenderTarget } from "three";
      function Scene({ shouldDispose }) {
        useEffect(() => {
          const target = new WebGLRenderTarget(1, 1);
          if (shouldDispose) target.dispose();
        }, [shouldDispose]);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
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

  it("tracks direct and guarded-lazy useRef render targets", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderTarget } from "three";
      function DirectMissing() {
        const targetRef = useRef(new WebGLRenderTarget(1, 1));
        targetRef.current.setSize(2, 2);
        return null;
      }
      function LazyComplete() {
        const targetRef = useRef(null);
        if (!targetRef.current) targetRef.current = new WebGLRenderTarget(1, 1);
        const target = targetRef.current;
        useEffect(() => () => target.dispose(), []);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
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

  it("requires React to own cleanup execution", () => {
    const code = `
      import { useMemo } from "react";
      import { WebGLRenderTarget } from "three";
      function useTarget() {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        return () => target.dispose();
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
  });

  it("rejects conditional cleanup execution", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { WebGLRenderTarget } from "three";
      function Scene({ enabled }) {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        useEffect(() => () => {
          if (enabled) target.dispose();
        }, [enabled, target]);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(1);
  });

  it("rejects overwritten direct and ref resource identities", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderTarget } from "three";
      function Direct({ borrowed }) {
        let target = new WebGLRenderTarget(1, 1);
        target = borrowed;
        useEffect(() => () => target.dispose(), [target]);
        return null;
      }
      function Ref({ borrowed }) {
        const targetRef = useRef(null);
        if (!targetRef.current) targetRef.current = new WebGLRenderTarget(1, 1);
        targetRef.current = borrowed;
        useEffect(() => () => targetRef.current.dispose(), []);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(2);
  });

  it("reports eager hook allocation while preserving lazy hook ownership", () => {
    const code = `
      import { useEffect, useRef, useState } from "react";
      import { WebGLRenderTarget } from "three";
      function EagerRef() {
        const targetRef = useRef(new WebGLRenderTarget(1, 1));
        useEffect(() => () => targetRef.current.dispose(), []);
        return null;
      }
      function EagerState() {
        const [target] = useState(new WebGLRenderTarget(1, 1));
        useEffect(() => () => target.dispose(), [target]);
        return null;
      }
      function LazyRef() {
        const targetRef = useRef(null);
        if (!targetRef.current) targetRef.current = new WebGLRenderTarget(1, 1);
        useEffect(() => () => targetRef.current.dispose(), []);
        return null;
      }
      function LazyState() {
        const [target] = useState(() => new WebGLRenderTarget(1, 1));
        useEffect(() => () => target.dispose(), [target]);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(2);
  });

  it("rejects non-function effect returns and cleanup that may not execute", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { WebGLRenderTarget } from "three";
      function ArrayCleanup() {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        useEffect(() => [() => target.dispose()], [target]);
      }
      function ObjectCleanup() {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        useEffect(() => ({ dispose: () => target.dispose() }), [target]);
      }
      function LoopCleanup() {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        useEffect(() => () => {
          for (const value of []) target.dispose();
        }, [target]);
      }
      function EarlyReturnCleanup({ ready }) {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        useEffect(() => () => {
          if (!ready) return;
          target.dispose();
        }, [ready, target]);
      }
      function ConditionalEffect({ ready }) {
        const target = useMemo(() => new WebGLRenderTarget(1, 1), []);
        if (ready) useEffect(() => () => target.dispose(), [target]);
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(5);
  });

  it("supports exact null guards and rejects destructuring overwrites", () => {
    const code = `
      import { useEffect, useRef } from "react";
      import { WebGLRenderTarget } from "three";
      function NullGuardMissing() {
        const targetRef = useRef(null);
        if (targetRef.current === null) targetRef.current = new WebGLRenderTarget(1, 1);
        return null;
      }
      function NullGuardComplete() {
        const targetRef = useRef(null);
        if (null === targetRef.current) targetRef.current = new WebGLRenderTarget(1, 1);
        useEffect(() => () => targetRef.current.dispose(), []);
        return null;
      }
      function DestructuredOverwrite({ replacement }) {
        let target = new WebGLRenderTarget(1, 1);
        [target] = [replacement];
        useEffect(() => () => target.dispose(), [target]);
        return null;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(2);
  });

  it("reports eager hook allocation outside canonical destructuring", () => {
    const code = `
      import { useRef, useState } from "react";
      import { WebGLRenderTarget } from "three";
      function Tuple() {
        const state = useState(new WebGLRenderTarget(1, 1));
        return state[0].width;
      }
      function Indexed() {
        return useState(new WebGLRenderTarget(1, 1))[0].width;
      }
      function Discarded() {
        useState(new WebGLRenderTarget(1, 1));
        return null;
      }
      function NestedRef() {
        const resources = useRef({ target: new WebGLRenderTarget(1, 1) });
        return resources.current.target.width;
      }
    `;
    expect(runRule(threeRequireRenderTargetCleanup, code).diagnostics).toHaveLength(4);
  });

  it("handles a high density of lifecycle allocations", () => {
    const declarations = Array.from(
      { length: LIFECYCLE_ANALYSIS_LARGE_ALLOCATION_COUNT },
      (_, allocationIndex) => `const target${allocationIndex} = new WebGLRenderTarget(1, 1);`,
    ).join("\n");
    const code = `
      import { WebGLRenderTarget } from "three";
      function Scene() {
        ${declarations}
        return null;
      }
    `;
    const result = runRule(threeRequireRenderTargetCleanup, code);

    expect(result.diagnostics).toHaveLength(LIFECYCLE_ANALYSIS_LARGE_ALLOCATION_COUNT);
  });

  it("matches cleanup effects across dense lifecycle allocations", () => {
    const lifecyclePairs = Array.from(
      { length: LIFECYCLE_ANALYSIS_DENSE_EFFECT_COUNT },
      (_, allocationIndex) => `
        const target${allocationIndex} = useMemo(
          () => new WebGLRenderTarget(1, 1),
          [],
        );
        useEffect(() => () => target${allocationIndex}.dispose(), [target${allocationIndex}]);
      `,
    ).join("\n");
    const code = `
      import { useEffect, useMemo } from "react";
      import { WebGLRenderTarget } from "three";
      function Scene() {
        ${lifecyclePairs}
        return null;
      }
    `;
    lifecycleCleanupMethodCounter.mockClear();
    const result = runRule(threeRequireRenderTargetCleanup, code);

    expect(result.diagnostics).toHaveLength(0);
    expect(lifecycleCleanupMethodCounter).toHaveBeenCalledTimes(
      LIFECYCLE_ANALYSIS_DENSE_EFFECT_COUNT,
    );
  });
});
