import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoConstantOutOfBoundsIndex } from "./three-shader-no-constant-out-of-bounds-index.js";

describe("three-shader-no-constant-out-of-bounds-index", () => {
  it("reports constant global array, vector, and matrix indices outside their bounds", () => {
    const code = `
      import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: "uniform float values[3]; uniform vec3 direction; uniform mat3 matrix; void main() { float value = values[3] + direction[-1] + matrix[3][0]; gl_FragColor = vec4(value); }",
      });
    `;

    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(3);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float values[3]; uniform vec3 direction; uniform mat3 matrix; void main() { float value = values[2] + direction[0] + matrix[2][0]; gl_FragColor = vec4(value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float values[3]; uniform int index; void main() { gl_FragColor = vec4(values[index]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform float values[3]; void main() { float values[4]; gl_FragColor = vec4(values[3]); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "uniform float values[3]; void main() { gl_FragColor = vec4(values[3]); }" });`,
  ])("keeps in-bounds, dynamic, shadowed, dynamic-source, and unrelated indexing quiet", (code) => {
    expect(runRule(threeShaderNoConstantOutOfBoundsIndex, code).diagnostics).toHaveLength(0);
  });
});
