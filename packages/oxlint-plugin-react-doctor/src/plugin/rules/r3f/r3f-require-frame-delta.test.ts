import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireFrameDelta } from "./r3f-require-frame-delta.js";

describe("r3f-require-frame-delta", () => {
  it("flags fixed transform increments", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame(({ scene }) => { scene.rotation.y += 0.01; scene.position.x++; });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags parenthesized transform increments", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame(({ scene }) => { (scene.rotation).y += 0.01; ++(scene.position.x); });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows delta-scaled transforms and unrelated counters", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame((state, delta) => { mesh.current.position.x += speed * delta; counter.current += 1; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a fixed rotation correction immediately after lookAt resets the same object", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       import { useRef } from "react";
       const Globe = () => {
         const globeRef = useRef(null);
         useFrame(() => {
           if (!globeRef.current) return;
           globeRef.current.lookAt(center);
           globeRef.current.rotation.z += Math.PI / 2;
         });
         return <group ref={globeRef} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `first.current.lookAt(center); second.current.rotation.z += Math.PI / 2;`,
    `mesh.current.rotation.z += Math.PI / 2; mesh.current.lookAt(center);`,
    `mesh.current.lookAt(center); mesh.current.position.x += 0.1;`,
    `if (shouldTrack) mesh.current.lookAt(center); mesh.current.rotation.z += Math.PI / 2;`,
    `mesh.current.lookAt(center); updateTarget(); mesh.current.rotation.z += Math.PI / 2;`,
  ])("keeps genuine fixed per-frame changes after non-proving lookAt shapes", (frameBody) => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       import { useRef } from "react";
       const Scene = () => {
         const mesh = useRef(null);
         const first = useRef(null);
         const second = useRef(null);
         useFrame(() => { ${frameBody} });
         return <><mesh ref={mesh} /><mesh ref={first} /><mesh ref={second} /></>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags fixed Three and transform interpolation factors", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { MathUtils } from "three";
       import { useFrame } from "@react-three/fiber";
       const alpha = 1 / 10;
       useFrame(({ camera }) => {
         camera.position.lerp(target, 0.05);
         value.current = MathUtils.lerp(value.current, targetValue, alpha);
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports namespace MathUtils and quaternion interpolation", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import * as THREE from "three";
       import { useFrame } from "@react-three/fiber";
       useFrame(({ camera }) => {
         value.current = THREE.MathUtils["lerp"](value.current, targetValue, 0.2);
         camera.quaternion.slerp(target, 0.1);
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags direct interpolation on exact JSX-managed refs and useThree selectors", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame, useThree } from "@react-three/fiber";
       import { useRef } from "react";
       const Scene = () => {
         const color = useRef(null);
         const camera = useThree((state) => state.camera);
         useFrame(() => {
           color.current.lerp(targetColor, 0.1);
           camera.position.lerp(targetPosition, 0.1);
         });
         return <color ref={color} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it.each([
    `const { MathUtils } = require("three");`,
    `const THREE = require("three"); const MathUtils = THREE.MathUtils;`,
    `const MathUtils = require("three").MathUtils;`,
  ])("supports CommonJS Three.js MathUtils provenance", (threeImport) => {
    const result = runRule(
      r3fRequireFrameDelta,
      `${threeImport}
       const { useFrame } = require("@react-three/fiber");
       useFrame(() => { value.current = MathUtils.lerp(value.current, targetValue, 0.2); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows callback-delta-derived, endpoint, guarded, and unrelated interpolation", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { MathUtils } from "three";
       import { useFrame } from "@react-three/fiber";
       useFrame((_, delta) => {
         const frameDelta = delta;
         camera.position.lerp(target, 1 - Math.exp(-speed * frameDelta));
         camera.position.lerp(target, 1);
         if (didStart) camera.position.lerp(target, 0.1);
         if (didStart) targets.forEach((target) => camera.position.lerp(target, 0.1));
         domain.lerp(target, 0.1);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows guarded one-shot transform increments", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => { if (didStart) mesh.current.position.x += 0.1; didFinish && mesh.current.rotation.y++; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `if (meshRef.current) meshRef.current.rotation.y += 0.03;`,
    `if (meshRef.current !== null) meshRef.current.rotation.y += 0.03;`,
    `if (!meshRef.current) {} else meshRef.current.rotation.y += 0.03;`,
    `meshRef.current && meshRef.current.rotation.y++;`,
    `!meshRef.current || meshRef.current.position.x++;`,
  ])("flags fixed transforms behind React ref availability guards", (guardedUpdate) => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       import { useRef } from "react";
       const Scene = () => {
         const meshRef = useRef(null);
         useFrame(() => { ${guardedUpdate} });
         return <mesh ref={meshRef} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps non-React current-property guards quiet", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       const meshRef = { current: mesh };
       useFrame(() => { if (meshRef.current) meshRef.current.rotation.y += 0.03; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps interpolation on non-React current properties quiet", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       const value = { current: { lerp() {} } };
       useFrame(() => { value.current.lerp(target, 0.1); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows transform increments in a conditionally called local helper", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       useFrame(() => {
         const advance = () => { mesh.current.position.x += 0.1; };
         if (didStart) advance();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a defaulted callback delta parameter", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame((_, delta = 0) => { mesh.current.position.x += speed * delta; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat nonexistent RootState delta fields as frame timing", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       useFrame((state) => { state.camera.position.x += speed * state.delta; });
       useFrame(({ scene, delta }) => { scene.rotation.y += speed * delta; });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores domain objects that happen to expose transform-shaped properties", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber";
       const ringBuffer = { position: 0, rotation: { y: 0 }, lerp() {} };
       useFrame(() => { ringBuffer.position++; ringBuffer.rotation.y += 0.1; ringBuffer.lerp(target, 0.1); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
