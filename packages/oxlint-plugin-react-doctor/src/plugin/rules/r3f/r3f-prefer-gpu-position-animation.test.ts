import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fPreferGpuPositionAnimation } from "./r3f-prefer-gpu-position-animation.js";

describe("r3f-prefer-gpu-position-animation", () => {
  it("reports repeated writes through an R3F-managed position attribute ref", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const positions = useRef();
        useFrame(() => {
          for (let index = 0; index < 100; index += 1) positions.current.setXYZ(index, index, 0, 0);
        });
        return <bufferGeometry><bufferAttribute ref={positions} attach="attributes-position" args={[new Float32Array(300), 3]} /></bufferGeometry>;
      };
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("reports repeated position-buffer writes in useFrame", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const Particles = ({ geometry }) => {
        const positions = geometry.attributes.position;
        useFrame(({ clock }) => {
          for (let index = 0; index < positions.count; index += 1) {
            positions.setXYZ(index, index, clock.elapsedTime, 0);
          }
          positions.needsUpdate = true;
        });
        return <points geometry={geometry} />;
      };
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("reports eager iterator writes reached from useFrame", () => {
    const code = `
      import { useFrame as onFrame } from "@react-three/fiber";
      const Particles = ({ geometry }) => {
        onFrame(() => {
          [0, 1, 2].forEach((index) => {
            geometry.getAttribute("position").setY(index, performance.now());
          });
        });
        return <points geometry={geometry} />;
      };
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("reports direct typed-array rewrites and bulk copies in useFrame", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const Particles = ({ geometry, nextPositions }) => {
        const positionArray = geometry.attributes.position.array;
        useFrame(() => {
          for (let index = 0; index < positionArray.length; index += 1) {
            positionArray[index] += 1;
          }
          geometry.getAttribute("position").array.set(nextPositions);
        });
        return <points geometry={geometry} />;
      };
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("reports a frame callback once when it rewrites several position components", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const Particles = ({ geometry }) => {
        const positions = geometry.attributes.position.array;
        useFrame(() => {
          for (let index = 0; index < positions.length; index += 3) {
            positions[index] += 1;
            positions[index + 1] += 1;
            positions[index + 2] += 1;
          }
        });
        return <points geometry={geometry} />;
      };
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("allows one-off position writes, other attributes, and shader animation", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const Particles = ({ geometry, colorAttribute, material }) => {
        useFrame(({ clock }) => {
          geometry.attributes.position.setY(0, clock.elapsedTime);
          for (let index = 0; index < colorAttribute.count; index += 1) {
            colorAttribute.setXYZ(index, 1, 0, 0);
          }
          geometry.attributes.position.array[0] = 1;
          material.uniforms.time.value = clock.elapsedTime;
        });
        return <points geometry={geometry} material={material} />;
      };
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(0);
  });

  it("ignores writes outside useFrame and shadowed hooks", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const prepare = (geometry) => {
        for (let index = 0; index < geometry.attributes.position.count; index += 1) {
          geometry.attributes.position.setX(index, index);
        }
      };
      const custom = (useFrame, geometry) => useFrame(() => {
        for (const index of indices) geometry.attributes.position.setX(index, index);
      });
    `;
    expect(runRule(r3fPreferGpuPositionAnimation, code).diagnostics).toHaveLength(0);
  });
});
