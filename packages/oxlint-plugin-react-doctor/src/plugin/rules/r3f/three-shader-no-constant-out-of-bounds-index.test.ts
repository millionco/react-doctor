import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoConstantOutOfBoundsIndex } from "./three-shader-no-constant-out-of-bounds-index.js";

describe("three-shader-no-constant-out-of-bounds-index", () => {
  it("reports constant global array, vector, and matrix indices outside their bounds", () => {
    const code = `
      import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: "uniform float values[3]; uniform vec3 direction; uniform mat3 matrix; void main() { float value = values[3] + direction[-1] + matrix[3][0]; gl_FragColor = vec4(value); }",
      });
    `;

    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(3);
  });

  it("reports type-prefix arrays and nested vector and matrix indices outside their bounds", () => {
    const code = `
      import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: "uniform float[3] values; uniform vec3 vectors[2]; uniform mat2x3 matrix; void main() { float value = values[3] + vectors[0][3] + matrix[0][3]; gl_FragColor = vec4(value); }",
      });
    `;

    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(3);
  });

  it("reports out-of-bounds indices followed by swizzles", () => {
    const code = `import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: "uniform mat3 matrix; uniform vec3 vectors[2]; void main() { float value = matrix[3].x + vectors[2].x; gl_FragColor = vec4(value); }",
      });`;

    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(2);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float values[3]; uniform vec3 direction; uniform mat3 matrix; void main() { float value = values[2] + direction[0] + matrix[2][0]; gl_FragColor = vec4(value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform vec3 vectors[2]; uniform mat2x3 matrix; void main() { float value = vectors[0][2] + matrix[0][2]; gl_FragColor = vec4(value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float values[3]; uniform int index; void main() { gl_FragColor = vec4(values[index]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float values[3]; void main() { float values[4]; gl_FragColor = vec4(values[3]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform imat3 invalidMatrix; uniform umat2 anotherInvalidMatrix; void main() { float value = invalidMatrix[3][0] + anotherInvalidMatrix[2][0]; gl_FragColor = vec4(value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "uniform float values[3]; void main() { gl_FragColor = vec4(values[3]); }" });`,
  ])("keeps in-bounds, dynamic, shadowed, dynamic-source, and unrelated indexing quiet", (code) => {
    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(0);
  });

  it("does not infer vector bounds for arrays with non-constant lengths", () => {
    const code = `import { ShaderMaterial } from "three";
      new ShaderMaterial({
        fragmentShader: "const int COUNT = 4; uniform vec3 values[COUNT]; void main() { gl_FragColor = vec4(values[3], 1.0); }",
      });`;

    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(0);
  });

  it("checks known element bounds after an array with an unknown length", () => {
    const code = `import { ShaderMaterial } from "three";
      new ShaderMaterial({
        fragmentShader: "const int COUNT = 4; uniform vec3 values[COUNT]; void main() { gl_FragColor = vec4(values[0][3]); }",
      });`;

    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(1);
  });
});
