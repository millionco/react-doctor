import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoRedeclaredBuiltins } from "./three-shader-no-redeclared-builtins.js";

describe("three-shader-no-redeclared-builtins", () => {
  it("reports built-in declarations that collide with ShaderMaterial prefixes", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        vertexShader: "uniform mat4 projectionMatrix; attribute vec3 position; void main() { gl_Position = projectionMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform vec3 cameraPosition; void main() { gl_FragColor = vec4(cameraPosition, 1.0); }",
      });
    `;

    expect(runRule(threeShaderNoRedeclaredBuiltins, code).diagnostics).toHaveLength(3);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ vertexShader: "uniform mat4 projectionMatrix; attribute vec3 position; void main() { gl_Position = projectionMatrix * vec4(position, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "attribute vec3 customPosition; void main() { gl_Position = vec4(customPosition, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ vertexShader: "uniform mat4 projectionMatrix; void main() {}" });`,
  ])(
    "keeps implicit use, raw declarations, custom names, dynamic, and unrelated shaders quiet",
    (code) => {
      expect(runRule(threeShaderNoRedeclaredBuiltins, code).diagnostics).toHaveLength(0);
    },
  );
});
