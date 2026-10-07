import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRawShaderRequireGlsl3Version } from "./three-raw-shader-require-glsl3-version.js";

describe("three-raw-shader-require-glsl3-version", () => {
  it.each([
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "in vec3 position; void main() { gl_Position = vec4(position, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "precision highp float; uniform sampler2D map; out vec4 color; void main() { color = texture(map, vec2(0.0)); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "precision highp float; void main() { int value = 1 << 2; }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "precision highp float; void main() { int value = 1; value <<= 2; }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "uniform mat2x3 transform; void main() { gl_Position = vec4(transform[0], 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "void main() { mat2x3 transform = mat2x3(1.0); gl_Position = vec4(transform[0], 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "void main() { uvec3 color = uvec3(uint(1)); gl_FragColor = vec4(color, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "uniform isampler2D map; void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "uniform usamplerCube map; void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "uniform sampler2D map; void main() { gl_FragColor = textureGrad(map, vec2(0.0), vec2(1.0), vec2(1.0)); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "void main() { gl_FragColor = vec4(sinh(1.0)); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "void main() { uint packed = packUnorm2x16(vec2(1.0)); gl_FragColor = vec4(float(packed)); }" });`,
  ])("reports GLSL 3-only raw shader syntax without a GLSL3 option", (code) => {
    expect(runRule(threeRawShaderRequireGlsl3Version, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: "in vec3 position; void main() { gl_Position = vec4(position, 1.0); }" });`,
    `import * as THREE from "three"; new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, fragmentShader: "precision highp float; out vec4 color; void main() { color = vec4(1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ glslVersion, fragmentShader: "precision highp float; out vec4 color; void main() { color = vec4(1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "attribute vec3 position; varying vec2 vUv; void main() { gl_Position = vec4(position, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "void main() { ivec3 value = ivec3(1); gl_FragColor = vec4(value, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "void main() { imat3 invalidType; umat2 anotherInvalidType; gl_FragColor = vec4(1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "float uintColor(float value) { return value; } void main() { gl_FragColor = vec4(uintColor(1.0)); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "struct uintColor { float value; }; uniform uintColor color; void main() { gl_FragColor = vec4(color.value); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "struct mat2x3f { float value; }; uniform mat2x3f transform; void main() { gl_FragColor = vec4(transform.value); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "struct isamplerConfig { float value; }; uniform isamplerConfig config; void main() { gl_FragColor = vec4(config.value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "out vec4 color; void main() { color = vec4(1.0); }" });`,
    `class RawShaderMaterial {}; new RawShaderMaterial({ fragmentShader: "out vec4 color; void main() {}" });`,
  ])("keeps GLSL3-configured, dynamic, GLSL1, managed, and unrelated shaders quiet", (code) => {
    expect(runRule(threeRawShaderRequireGlsl3Version, code).diagnostics).toHaveLength(0);
  });
});
