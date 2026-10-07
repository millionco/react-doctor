import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderRequireCompatibleUniformValues } from "./three-shader-require-compatible-uniform-values.js";

describe("three-shader-require-compatible-uniform-values", () => {
  it.each([
    `import { ShaderMaterial, Vector3 } from "three"; new ShaderMaterial({ uniforms: { time: { value: new Vector3() } }, fragmentShader: "uniform float time; void main() { gl_FragColor = vec4(time); }" });`,
    `import { ShaderMaterial, Vector2 } from "three"; new ShaderMaterial({ uniforms: { color: { value: new Vector2() } }, fragmentShader: "uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }" });`,
    `import { Matrix3, ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { transform: { value: new Matrix3() } }, vertexShader: "uniform mat4 transform; void main() { gl_Position = transform * vec4(position, 1.0); }" });`,
    `import { ShaderMaterial, Texture } from "three"; new ShaderMaterial({ uniforms: { environment: { value: new Texture() } }, fragmentShader: "uniform samplerCube environment; void main() { gl_FragColor = textureCube(environment, vec3(1.0)); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { offset: { value: [1, 2, 3] } }, vertexShader: "uniform vec2 offset; void main() { gl_Position = vec4(offset, 0.0, 1.0); }" });`,
  ])("reports statically incompatible uniform values", (code) => {
    expect(runRule(threeShaderRequireCompatibleUniformValues, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial, Vector2 } from "three"; new ShaderMaterial({ uniforms: { offset: { value: new Vector2() } }, vertexShader: "uniform vec2 offset; void main() { gl_Position = vec4(offset, 0.0, 1.0); }" });`,
    `import { Color, ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { color: { value: new Color() } }, fragmentShader: "uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }" });`,
    `import { CubeTexture, ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { environment: { value: new CubeTexture() } }, fragmentShader: "uniform samplerCube environment; void main() { gl_FragColor = textureCube(environment, vec3(1.0)); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { transform: { value: new Float32Array(16) } }, vertexShader: "uniform mat4 transform; void main() { gl_Position = transform * vec4(position, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { color: { value: getColor() } }, fragmentShader: "uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }" });`,
    `import { ShaderMaterial, Vector2 } from "three"; new ShaderMaterial({ uniforms: { offsets: { value: [new Vector2(), new Vector2()] } }, vertexShader: "uniform vec2 offsets[2]; void main() { gl_Position = vec4(offsets[0], 0.0, 1.0); }" });`,
  ])("keeps compatible, dynamic, and array uniform values quiet", (code) => {
    expect(runRule(threeShaderRequireCompatibleUniformValues, code).diagnostics).toHaveLength(0);
  });
});
