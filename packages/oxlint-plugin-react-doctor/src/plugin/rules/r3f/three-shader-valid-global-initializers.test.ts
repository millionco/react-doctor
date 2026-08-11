import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderValidGlobalInitializers } from "./three-shader-valid-global-initializers.js";

describe("three-shader-valid-global-initializers", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float uTime = 1.0; void main() { gl_FragColor = vec4(uTime); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "attribute vec3 offset = vec3(0.0); void main() { gl_Position = vec4(position + offset, 1.0); }" });`,
    `import { ShaderMaterial, GLSL3 } from "three"; new ShaderMaterial({ glslVersion: GLSL3, fragmentShader: "out vec4 color = vec4(1.0); void main() { color = vec4(1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "const float scale; void main() { gl_Position = vec4(scale); }" });`,
  ])("reports storage-qualified initializers and uninitialized constants", (code) => {
    expect(runRule(threeShaderValidGlobalInitializers, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { uTime: { value: 1 } }, fragmentShader: "uniform float uTime; const float scale = 2.0; float bias = 1.0; void main() { gl_FragColor = vec4(uTime * scale + bias); }" });`,
    `import { ShaderMaterial } from "three"; const shader = getShader(); new ShaderMaterial({ fragmentShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "uniform float uTime = 1.0; void main() {}" });`,
  ])("keeps legal and unresolved global declarations quiet", (code) => {
    expect(runRule(threeShaderValidGlobalInitializers, code).diagnostics).toHaveLength(0);
  });
});
