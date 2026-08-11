import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidBufferAttributeItemSize } from "./r3f-valid-buffer-attribute-item-size.js";

describe("r3f-valid-buffer-attribute-item-size", () => {
  it("reports invalid static item sizes", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <bufferAttribute args={[new Float32Array(9), 0]} />
        <float32BufferAttribute args={[data, 1.5]} />
      </Canvas>;
    `;
    expect(runRule(r3fValidBufferAttributeItemSize, code).diagnostics).toHaveLength(2);
  });

  it("allows positive, dynamic, and spread values", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <Canvas>
        <bufferAttribute args={[new Float32Array(9), 3]} />
        <bufferAttribute args={[data, itemSize]} />
        <bufferAttribute {...props} args={[data, 0]} />
      </Canvas>;
    `;
    expect(runRule(r3fValidBufferAttributeItemSize, code).diagnostics).toHaveLength(0);
  });
});
