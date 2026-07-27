import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderRequireMatchingUniforms } from "./three-shader-require-matching-uniforms.js";

describe("three-shader-require-matching-uniforms", () => {
  it.each([
    {
      fragment: "uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }",
      vertex: "uniform vec4 uColor; void main() { gl_Position = uColor; }",
    },
    {
      fragment: "uniform float values[3]; void main() { gl_FragColor = vec4(values[0]); }",
      vertex: "uniform float values[2]; void main() { gl_Position = vec4(values[0]); }",
    },
    {
      fragment: "uniform highp float amount; void main() { gl_FragColor = vec4(amount); }",
      vertex: "uniform mediump float amount; void main() { gl_Position = vec4(amount); }",
    },
    {
      fragment: "uniform float[3] values; void main() { gl_FragColor = vec4(values[0]); }",
      vertex: "uniform float[2] values; void main() { gl_Position = vec4(values[0]); }",
    },
    {
      fragment: "uniform float value; void main() { gl_FragColor = vec4(value); }",
      vertex:
        "const int COUNT = 3; uniform float value[COUNT]; void main() { gl_Position = vec4(value[0]); }",
    },
  ])(
    "reports statically used uniforms with incompatible stage declarations",
    ({ fragment, vertex }) => {
      const code = `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: ${JSON.stringify(vertex)}, fragmentShader: ${JSON.stringify(fragment)} });`;

      expect(runRule(threeShaderRequireMatchingUniforms, code).diagnostics).toHaveLength(1);
    },
  );

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform vec3 uColor; void main() { gl_Position = vec4(uColor, 1.0); }", fragmentShader: "uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform vec3 uColor; void main() { gl_Position = vec4(0.0); }", fragmentShader: "uniform vec4 uColor; void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform vec3 vertexOnly; void main() { gl_Position = vec4(vertexOnly, 1.0); }", fragmentShader: "uniform vec3 fragmentOnly; void main() { gl_FragColor = vec4(fragmentOnly, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "const int COUNT = 3; uniform float values[COUNT]; void main() { gl_Position = vec4(values[0]); }", fragmentShader: "uniform float values[3]; void main() { gl_FragColor = vec4(values[0]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform highp float amount; void main() { gl_Position = vec4(amount); }", fragmentShader: "uniform float amount; void main() { gl_FragColor = vec4(amount); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader, fragmentShader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ vertexShader: "uniform vec3 value; void main() { gl_Position = vec4(value, 1.0); }", fragmentShader: "uniform vec4 value; void main() { gl_FragColor = value; }" });`,
  ])("keeps matching, unused, stage-local, dynamic, and unrelated uniforms quiet", (code) => {
    expect(runRule(threeShaderRequireMatchingUniforms, code).diagnostics).toHaveLength(0);
  });
});
