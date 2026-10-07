import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoGlsl1SyntaxWithGlsl3 } from "./three-shader-no-glsl1-syntax-with-glsl3.js";

describe("three-shader-no-glsl1-syntax-with-glsl3", () => {
  it.each([
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: "precision highp float; attribute vec3 position; void main() { gl_Position = vec4(position, 1.0); }" });`,
    `import * as THREE from "three"; new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: "precision highp float; varying vec2 vUv; void main() { vUv = vec2(0.0); gl_Position = vec4(0.0); }" });`,
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, fragmentShader: "precision highp float; uniform sampler2D map; out vec4 color; void main() { color = texture2D(map, vec2(0.0)); }" });`,
    `import { ShaderMaterial, GLSL3 } from "three"; new ShaderMaterial({ glslVersion: GLSL3, fragmentShader: "void main() { gl_FragColor = vec4(1.0); }" });`,
  ])("reports GLSL 1-only declarations, calls, and outputs", (code) => {
    expect(runRule(threeShaderNoGlsl1SyntaxWithGlsl3, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: "precision highp float; in vec3 position; out vec2 vUv; void main() { vUv = vec2(0.0); gl_Position = vec4(position, 1.0); }", fragmentShader: "precision highp float; in vec2 vUv; uniform sampler2D map; out vec4 color; void main() { color = texture(map, vUv); }" });`,
    `import { ShaderMaterial, GLSL3 } from "three"; new ShaderMaterial({ glslVersion: GLSL3, fragmentShader: "out vec4 color; void main() { color = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, fragmentShader: "precision highp float; #define texture2D texture\nuniform sampler2D map; out vec4 color; void main() { color = texture2D(map, vec2(0.0)); }" });`,
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, fragmentShader: "precision highp float; vec4 texture2D(sampler2D map, vec2 uv) { return vec4(1.0); } uniform sampler2D map; out vec4 color; void main() { color = texture2D(map, vec2(0.0)); }" });`,
    `class ShaderMaterial {}; new ShaderMaterial({ glslVersion: "300 es", fragmentShader: "void main() { gl_FragColor = vec4(1.0); }" });`,
  ])("keeps compatible, aliased, GLSL 1, and unrelated shaders quiet", (code) => {
    expect(runRule(threeShaderNoGlsl1SyntaxWithGlsl3, code).diagnostics).toHaveLength(0);
  });
});
