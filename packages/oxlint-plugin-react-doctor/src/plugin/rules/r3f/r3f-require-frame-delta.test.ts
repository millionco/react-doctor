import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireFrameDelta } from "./r3f-require-frame-delta.js";

describe("r3f-require-frame-delta", () => {
  it("flags fixed transform increments", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => { mesh.current.rotation.y += 0.01; mesh.current.position.x++; });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags parenthesized transform increments", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => { (mesh.current.rotation).y += 0.01; ++(mesh.current.position.x); });`,
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

  it("flags fixed Three and transform interpolation factors", () => {
    const result = runRule(
      r3fRequireFrameDelta,
      `import { MathUtils } from "three";
       import { useFrame } from "@react-three/fiber";
       const alpha = 1 / 10;
       useFrame(() => {
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
       useFrame(() => {
         value.current = THREE.MathUtils["lerp"](value.current, targetValue, 0.2);
         mesh.current.quaternion.slerp(target, 0.1);
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
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
       useFrame((state) => { mesh.current.position.x += speed * state.delta; });
       useFrame(({ delta }) => { mesh.current.rotation.y += speed * delta; });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });
});
