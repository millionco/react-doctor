import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fPreferGpuInstancedAnimation } from "./r3f-prefer-gpu-instanced-animation.js";

describe("r3f-prefer-gpu-instanced-animation", () => {
  it("reports repeated matrix updates on an R3F-managed instanced mesh", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef } from "react";
      const Particles = ({ count }) => {
        const instances = useRef(null);
        useFrame(() => {
          for (let index = 0; index < count; index += 1) {
            instances.current.setMatrixAt(index, matrix);
          }
          instances.current.instanceMatrix.needsUpdate = true;
        });
        return <instancedMesh ref={instances} args={[geometry, material, count]} />;
      };
    `;
    expect(runRule(r3fPreferGpuInstancedAnimation, code).diagnostics).toHaveLength(1);
  });

  it("allows one-off updates, shader uniforms, ordinary refs, and shadowed hooks", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef } from "react";
      const Scene = ({ useFrame: customFrame }) => {
        const instances = useRef(null);
        const mesh = useRef(null);
        useFrame(() => {
          instances.current.setMatrixAt(0, matrix);
          for (const index of indices) mesh.current.setMatrixAt(index, matrix);
          material.uniforms.time.value += 1;
        });
        customFrame(() => {
          for (const index of indices) instances.current.setMatrixAt(index, matrix);
        });
        return <><instancedMesh ref={instances} /><mesh ref={mesh} /></>;
      };
    `;
    expect(runRule(r3fPreferGpuInstancedAnimation, code).diagnostics).toHaveLength(0);
  });
});
