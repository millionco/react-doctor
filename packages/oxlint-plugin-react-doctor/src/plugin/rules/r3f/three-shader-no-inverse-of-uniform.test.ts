import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoInverseOfUniform } from "./three-shader-no-inverse-of-uniform.js";

describe("three-shader-no-inverse-of-uniform", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform mat4 uTransform; void main() { gl_Position = inverse(uTransform) * vec4(0.0); }" });`,
    `import * as THREE from "three"; new THREE.RawShaderMaterial({ fragmentShader: "uniform mat3 normalMatrix; void main() { mat3 result = inverse(normalMatrix); gl_FragColor = vec4(result[0], 1.0); }" });`,
  ])("reports inverse applied directly to a uniform matrix", (code) => {
    expect(runRule(threeShaderNoInverseOfUniform, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform mat4 uTransform; void main() { mat4 localTransform = uTransform; gl_Position = inverse(localTransform) * vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "mat4 inverse(mat4 value) { return value; } uniform mat4 uTransform; void main() { gl_Position = inverse(uTransform) * vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "#define inverse(value) value\\nuniform mat4 uTransform; void main() { gl_Position = inverse(uTransform) * vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform mat4 uTransform; void main() { { mat4 uTransform = mat4(1.0); gl_Position = inverse(uTransform) * vec4(0.0); } }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ vertexShader: "uniform mat4 uTransform; void main() { gl_Position = inverse(uTransform) * vec4(0.0); }" });`,
  ])("keeps derived, shadowed, dynamic, and unrelated calls quiet", (code) => {
    expect(runRule(threeShaderNoInverseOfUniform, code).diagnostics).toHaveLength(0);
  });
});
