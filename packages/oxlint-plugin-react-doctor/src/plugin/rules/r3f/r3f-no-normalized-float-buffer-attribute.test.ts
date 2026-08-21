import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoNormalizedFloatBufferAttribute } from "./r3f-no-normalized-float-buffer-attribute.js";

describe("r3f-no-normalized-float-buffer-attribute", () => {
  it("reports normalized floating-point attributes", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const values = new Float32Array(9);
      export const Scene = () => <Canvas>
        <bufferAttribute args={[values, 3, true]} />
        <float32BufferAttribute args={[data, 3, true]} />
      </Canvas>;
    `;
    expect(runRule(r3fNoNormalizedFloatBufferAttribute, code).diagnostics).toHaveLength(2);
  });

  it("allows integer, false, dynamic, spread, and shadowed arrays", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <Canvas>
        <bufferAttribute args={[new Uint8Array(9), 3, true]} />
        <bufferAttribute args={[new Float32Array(9), 3, false]} />
        <bufferAttribute args={[new Float32Array(9), 3, normalized]} />
        <bufferAttribute {...props} args={[new Float32Array(9), 3, true]} />
      </Canvas>;
    `;
    expect(runRule(r3fNoNormalizedFloatBufferAttribute, code).diagnostics).toHaveLength(0);
  });
});
