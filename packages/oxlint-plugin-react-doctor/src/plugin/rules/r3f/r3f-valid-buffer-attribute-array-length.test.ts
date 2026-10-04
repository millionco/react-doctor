import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidBufferAttributeArrayLength } from "./r3f-valid-buffer-attribute-array-length.js";

describe("r3f-valid-buffer-attribute-array-length", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber"; const Scene = () => <bufferAttribute args={[new Float32Array(10), 3]} />;`,
    `import "@react-three/fiber"; const values = [0, 1, 2, 3, 4]; const Scene = () => <float32BufferAttribute args={[values, 2]} />;`,
  ])("reports an R3F attribute array with a partial item", (code) => {
    expect(runRule(r3fValidBufferAttributeArrayLength, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber"; const Scene = () => <bufferAttribute args={[new Float32Array(9), 3]} />;`,
    `import { Canvas } from "@react-three/fiber"; const Scene = () => <bufferAttribute args={[getValues(), 3]} />;`,
    `const Scene = () => <bufferAttribute args={[new Float32Array(10), 3]} />;`,
    `import { Canvas } from "@react-three/fiber"; const Scene = () => <bufferAttribute args={[new Float32Array(10), 3]} {...props} />;`,
  ])("keeps complete, unresolved, unrelated, and spread R3F attributes quiet", (code) => {
    expect(runRule(r3fValidBufferAttributeArrayLength, code).diagnostics).toHaveLength(0);
  });
});
