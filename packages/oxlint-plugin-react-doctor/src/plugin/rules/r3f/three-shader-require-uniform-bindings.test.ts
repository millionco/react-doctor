import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderRequireUniformBindings } from "./three-shader-require-uniform-bindings.js";

describe("three-shader-require-uniform-bindings", () => {
  it("reports missing custom uniforms once across shader stages", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        uniforms: { uBound: { value: 1 } },
        vertexShader: "uniform float uTime; uniform float uBound; void main() { gl_Position = vec4(uTime + uBound); }",
        fragmentShader: "uniform float uTime; uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, uTime); }",
      });
    `;

    expect(runRule(threeShaderRequireUniformBindings, code).diagnostics).toHaveLength(2);
  });

  it("reports Three built-in names when RawShaderMaterial does not bind them", () => {
    const code = `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix; void main() { gl_FragColor = vec4(projectionMatrix[0][0] + modelViewMatrix[0][0]); }" });`;

    expect(runRule(threeShaderRequireUniformBindings, code).diagnostics).toHaveLength(2);
  });

  it("reports feature-managed uniforms when their ShaderMaterial feature is disabled", () => {
    const code = `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform vec3 fogColor; void main() { gl_FragColor = vec4(fogColor, 1.0); }" });`;

    expect(runRule(threeShaderRequireUniformBindings, code).diagnostics).toHaveLength(1);
  });

  it("reports skinning uniforms when ShaderMaterial skinning is disabled", () => {
    const code = `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform mat4 bindMatrix; uniform mat4 bindMatrixInverse; void main() { gl_Position = bindMatrixInverse * bindMatrix * vec4(1.0); }" });`;

    expect(runRule(threeShaderRequireUniformBindings, code).diagnostics).toHaveLength(2);
  });

  it.each([
    `import { ShaderMaterial } from "three"; const uniforms = { uTime: { value: 0 } }; new ShaderMaterial({ uniforms, fragmentShader: "uniform float uTime; void main() { gl_FragColor = vec4(uTime); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float uUnused; void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix; void main() { gl_FragColor = vec4(projectionMatrix[0][0] + modelViewMatrix[0][0]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ lights: true, fragmentShader: "uniform vec3 ambientLightColor; void main() { gl_FragColor = vec4(ambientLightColor, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fog: true, fragmentShader: "uniform vec3 fogColor; void main() { gl_FragColor = vec4(fogColor, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ skinning: true, vertexShader: "uniform mat4 bindMatrix; uniform mat4 bindMatrixInverse; void main() { gl_Position = bindMatrixInverse * bindMatrix * vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; const fog = getFog(); new ShaderMaterial({ fog, fragmentShader: "uniform vec3 fogColor; void main() { gl_FragColor = vec4(fogColor, 1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: getUniforms(), fragmentShader: "uniform float uTime; void main() { gl_FragColor = vec4(uTime); }" });`,
    `import { ShaderMaterial } from "three"; const shared = {}; new ShaderMaterial({ uniforms: { ...shared }, fragmentShader: "uniform float uTime; void main() { gl_FragColor = vec4(uTime); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader });`,
    `import { ShaderMaterial } from "other"; new ShaderMaterial({ fragmentShader: "uniform float uTime; void main() { gl_FragColor = vec4(uTime); }" });`,
  ])(
    "keeps bound, unused, ShaderMaterial-managed, dynamic, spread, unresolved, and unrelated uniforms quiet",
    (code) => {
      expect(runRule(threeShaderRequireUniformBindings, code).diagnostics).toHaveLength(0);
    },
  );
});
