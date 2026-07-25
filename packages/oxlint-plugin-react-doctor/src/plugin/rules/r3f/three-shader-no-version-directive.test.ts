import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoVersionDirective } from "./three-shader-no-version-directive.js";

describe("three-shader-no-version-directive", () => {
  it("reports inline directives in both shader stages", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        vertexShader: "#version 300 es\\nvoid main() { gl_Position = vec4(0.0); }",
        fragmentShader: "#version 300 es\\nprecision highp float; out vec4 color; void main() { color = vec4(1.0); }",
      });
    `;

    expect(runRule(threeShaderNoVersionDirective, code).diagnostics).toHaveLength(2);
  });

  it("reports inline directives in raw shaders", () => {
    const code = `
      import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        vertexShader: "#version 300 es\\nvoid main() { gl_Position = vec4(0.0); }",
      });
    `;

    expect(runRule(threeShaderNoVersionDirective, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial, GLSL3 } from "three"; new ShaderMaterial({ glslVersion: GLSL3, vertexShader: "void main() { gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "#version 300 es\\nvoid main() {}" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "/*\\n#version 300 es\\n*/\\nvoid main() { gl_Position = vec4(0.0); }", fragmentShader: "// #version 300 es\\nvoid main() { gl_FragColor = vec4(1.0); }" });`,
  ])("keeps property-configured, dynamic, and unrelated shaders quiet", (code) => {
    expect(runRule(threeShaderNoVersionDirective, code).diagnostics).toHaveLength(0);
  });
});
