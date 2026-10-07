import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidBufferAttributeArrayLength } from "./three-valid-buffer-attribute-array-length.js";

describe("three-valid-buffer-attribute-array-length", () => {
  it.each([
    `import { BufferAttribute } from "three"; new BufferAttribute(new Float32Array(10), 3);`,
    `import * as THREE from "three"; const values = [0, 1, 2, 3, 4]; new THREE.Float32BufferAttribute(values, 2);`,
    `const { InstancedBufferAttribute } = require("three"); const values = new Uint8Array([0, 1, 2, 3, 4]); new InstancedBufferAttribute(values, 4);`,
  ])("reports an array length not divisible by itemSize", (code) => {
    expect(runRule(threeValidBufferAttributeArrayLength, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { BufferAttribute } from "three"; new BufferAttribute(new Float32Array(9), 3);`,
    `import { Float32BufferAttribute } from "three"; const values = [0, 1, 2, 3]; new Float32BufferAttribute(values, 2);`,
    `import { BufferAttribute } from "three"; new BufferAttribute(getValues(), 3);`,
    `import { BufferAttribute } from "three"; new BufferAttribute(new Float32Array(size), 3);`,
    `class BufferAttribute {}; new BufferAttribute(new Float32Array(10), 3);`,
    `const Float32Array = CustomArray; import { BufferAttribute } from "three"; new BufferAttribute(new Float32Array(10), 3);`,
  ])("keeps complete and unresolved attribute arrays quiet", (code) => {
    expect(runRule(threeValidBufferAttributeArrayLength, code).diagnostics).toHaveLength(0);
  });
});
