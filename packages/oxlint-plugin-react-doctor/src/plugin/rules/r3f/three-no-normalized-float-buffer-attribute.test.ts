import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoNormalizedFloatBufferAttribute } from "./three-no-normalized-float-buffer-attribute.js";

describe("three-no-normalized-float-buffer-attribute", () => {
  it("reports normalized float wrappers and typed arrays", () => {
    const code = `
      import { BufferAttribute, Float32BufferAttribute } from "three";
      const values = new Float32Array(9);
      new BufferAttribute(values, 3, true);
      new Float32BufferAttribute([], 3, true);
    `;
    expect(runRule(threeNoNormalizedFloatBufferAttribute, code).diagnostics).toHaveLength(2);
  });

  it("allows integer data, false, dynamic, shadowed arrays, and unrelated constructors", () => {
    const code = `
      import { BufferAttribute } from "three";
      import { BufferAttribute as Other } from "gpu-kit";
      new BufferAttribute(new Uint8Array(9), 3, true);
      new BufferAttribute(new Float32Array(9), 3, false);
      new BufferAttribute(new Float32Array(9), 3, normalized);
      const make = (Float32Array) => new BufferAttribute(new Float32Array(9), 3, true);
      new Other(new Float32Array(9), 3, true);
    `;
    expect(runRule(threeNoNormalizedFloatBufferAttribute, code).diagnostics).toHaveLength(0);
  });
});
