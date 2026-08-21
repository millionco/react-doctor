import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequirePositionBufferUpdate } from "./r3f-require-position-buffer-update.js";

describe("r3f-require-position-buffer-update", () => {
  it("reports repeated position-buffer writes without an upload flag", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const Scene = ({ geometry }) => {
        useFrame(() => {
          for (let index = 0; index < 100; index += 1) geometry.attributes.position.setX(index, index);
        });
        return null;
      };
    `;
    expect(runRule(r3fRequirePositionBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("tracks R3F position buffer refs", () => {
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
    expect(runRule(r3fRequirePositionBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows a matching upload flag and non-position buffers", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      const Scene = ({ geometry }) => {
        useFrame(() => {
          for (let index = 0; index < 100; index += 1) geometry.attributes.position.setX(index, index);
          geometry.attributes.position.needsUpdate = true;
          for (let index = 0; index < 100; index += 1) geometry.attributes.color.setX(index, index);
        });
        return null;
      };
    `;
    expect(runRule(r3fRequirePositionBufferUpdate, code).diagnostics).toHaveLength(0);
  });
});
