import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRawShaderRequireFragmentFloatPrecision } from "./three-raw-shader-require-fragment-float-precision.js";

describe("three-raw-shader-require-fragment-float-precision", () => {
  it.each([
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }" });`,
    `import * as THREE from "three"; new THREE.RawShaderMaterial({ fragmentShader: "float shade(vec2 uv) { return uv.x; } void main() { gl_FragColor = vec4(shade(vec2(0.0))); }" });`,
  ])("reports unqualified floating declarations without a default", (code) => {
    expect(runRule(threeRawShaderRequireFragmentFloatPrecision, code).diagnostics).toHaveLength(1);
  });

  it("reports unqualified declarations before a default precision statement", () => {
    const code = `import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: "varying vec2 vUv; precision mediump float; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }",
      });`;

    expect(runRule(threeRawShaderRequireFragmentFloatPrecision, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "precision mediump float; varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "highp vec2 value; void main() { gl_FragColor = vec4(value, 0.0, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "attribute vec3 position; void main() { gl_Position = vec4(position, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: shader });`,
    `class RawShaderMaterial {}; new RawShaderMaterial({ fragmentShader: "float value; void main() {}" });`,
  ])(
    "keeps defaulted, explicitly qualified, managed, vertex, dynamic, and unrelated shaders quiet",
    (code) => {
      expect(runRule(threeRawShaderRequireFragmentFloatPrecision, code).diagnostics).toHaveLength(
        0,
      );
    },
  );
});
