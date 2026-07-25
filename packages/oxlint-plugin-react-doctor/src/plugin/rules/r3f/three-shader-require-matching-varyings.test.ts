import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderRequireMatchingVaryings } from "./three-shader-require-matching-varyings.js";

describe("three-shader-require-matching-varyings", () => {
  it("reports a statically used fragment varying with no vertex output", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        vertexShader: "varying vec3 vColor; void main() { vColor = vec3(1.0); gl_Position = vec4(0.0); }",
        fragmentShader: "varying vec3 vMissing; void main() { gl_FragColor = vec4(vMissing, 1.0); }",
      });
    `;

    expect(runRule(threeShaderRequireMatchingVaryings, code).diagnostics).toHaveLength(1);
  });

  it.each([
    {
      fragment: "varying vec2 vData; void main() { gl_FragColor = vec4(vData, 0.0, 1.0); }",
      vertex: "varying vec3 vData; void main() { vData = vec3(1.0); gl_Position = vec4(0.0); }",
    },
    {
      fragment:
        "#version 300 es\nprecision highp float; flat in vec3 vData; out vec4 color; void main() { color = vec4(vData, 1.0); }",
      vertex:
        "#version 300 es\nprecision highp float; out vec3 vData; void main() { vData = vec3(1.0); gl_Position = vec4(0.0); }",
    },
    {
      fragment:
        "#version 300 es\nprecision highp float; centroid in vec3 vData; out vec4 color; void main() { color = vec4(vData, 1.0); }",
      vertex:
        "#version 300 es\nprecision highp float; out vec3 vData; void main() { vData = vec3(1.0); gl_Position = vec4(0.0); }",
    },
    {
      fragment:
        "#version 300 es\nprecision highp float; noperspective in vec3 vData; out vec4 color; void main() { color = vec4(vData, 1.0); }",
      vertex:
        "#version 300 es\nprecision highp float; smooth out vec3 vData; void main() { vData = vec3(1.0); gl_Position = vec4(0.0); }",
    },
    {
      fragment: "varying float value; void main() { gl_FragColor = vec4(value); }",
      vertex:
        "const int COUNT = 3; varying float value[COUNT]; void main() { value[0] = 1.0; gl_Position = vec4(0.0); }",
    },
  ])("reports incompatible stage interfaces %#", ({ fragment, vertex }) => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({ vertexShader: ${JSON.stringify(vertex)}, fragmentShader: ${JSON.stringify(fragment)} });
    `;

    expect(runRule(threeShaderRequireMatchingVaryings, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "varying vec3 vColor; void main() { vColor = vec3(1.0); gl_Position = vec4(0.0); }", fragmentShader: "varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position = vec4(0.0); }", fragmentShader: "varying vec3 unusedValue; void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "const int COUNT = 3; varying float values[COUNT]; void main() { values[0] = 1.0; gl_Position = vec4(0.0); }", fragmentShader: "varying float values[3]; void main() { gl_FragColor = vec4(values[0]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: \`#version 300 es
layout(location = 0) out vec3 first; void main() { first = vec3(1.0); gl_Position = vec4(0.0); }\`, fragmentShader: \`#version 300 es
precision highp float; layout(location = 0) in vec3 second; out vec4 color; void main() { color = vec4(second, 1.0); }\` });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader, fragmentShader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ vertexShader: "void main() {}", fragmentShader: "varying vec3 missing; void main() { gl_FragColor = vec4(missing, 1.0); }" });`,
  ])("keeps matching, unused, location-matched, dynamic, and unrelated shaders quiet", (code) => {
    expect(runRule(threeShaderRequireMatchingVaryings, code).diagnostics).toHaveLength(0);
  });
});
