import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoInvalidConstantBitOperations } from "./three-shader-no-invalid-constant-bit-operations.js";

describe("three-shader-no-invalid-constant-bit-operations", () => {
  it("reports invalid constant shifts and bitfield ranges", () => {
    const code = `
      import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: "void main() { int a = value << -1; int b = value >> 32; value <<= 32; value >>= -1; int c = bitfieldExtract(value, -1, 4); int d = bitfieldInsert(value, insert, 30, 4); }",
      });
    `;

    expect(runRule(threeShaderNoInvalidConstantBitOperations, code).diagnostics).toHaveLength(6);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { int a = value << 0; int b = value >> 31; int c = bitfieldExtract(value, 0, 32); int d = bitfieldInsert(value, insert, 30, 2); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform int shift; void main() { int value = 1 << shift; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "int bitfieldExtract(int value, int offset, int bits) { return value; } void main() { int result = bitfieldExtract(value, -1, 4); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#define bitfieldInsert(a, b, c, d) a\\nvoid main() { int result = bitfieldInsert(value, insert, -1, 4); }" });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "void main() { int value = 1 << 32; }" });`,
  ])("keeps valid, dynamic, shadowed, macro, and unrelated operations quiet", (code) => {
    expect(runRule(threeShaderNoInvalidConstantBitOperations, code).diagnostics).toHaveLength(0);
  });
});
