import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidBufferAttributeItemSize } from "./three-valid-buffer-attribute-item-size.js";

describe("three-valid-buffer-attribute-item-size", () => {
  it("reports nonpositive and fractional item sizes", () => {
    const code = `
      import { BufferAttribute, Float32BufferAttribute } from "three";
      new BufferAttribute(new Float32Array(9), 0);
      new Float32BufferAttribute([], -1);
      new Float32BufferAttribute([], 1.5);
    `;
    expect(runRule(threeValidBufferAttributeItemSize, code).diagnostics).toHaveLength(3);
  });

  it("allows positive integers, dynamic values, and unrelated constructors", () => {
    const code = `
      import { BufferAttribute } from "three";
      import { BufferAttribute as Other } from "gpu-kit";
      new BufferAttribute(new Float32Array(9), 3);
      new BufferAttribute(data, itemSize);
      new Other(data, 0);
    `;
    expect(runRule(threeValidBufferAttributeItemSize, code).diagnostics).toHaveLength(0);
  });
});
