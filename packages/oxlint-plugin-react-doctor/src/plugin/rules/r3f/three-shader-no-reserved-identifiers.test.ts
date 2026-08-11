import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoReservedIdentifiers } from "./three-shader-no-reserved-identifiers.js";

describe("three-shader-no-reserved-identifiers", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: \`float gl_custom; void main() { gl_Position = vec4(0.0); }\` });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: \`float color__channel; void main() { gl_FragColor = vec4(1.0); }\` });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: \`float gl_helper(float value) { return value; } void main() { gl_Position = vec4(gl_helper(1.0)); }\` });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: \`struct Surface__Data { float light; }; void main() { gl_FragColor = vec4(1.0); }\` });`,
  ])("reports reserved user-defined GLSL declarations", (code) => {
    expect(runRule(threeShaderNoReservedIdentifiers, code).diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: \`void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }\` });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: \`uniform float intensity; struct SurfaceData { float light; }; void main() { gl_FragColor = vec4(intensity); }\` });`,
    `const shader = \`float gl_custom;\`; buildMaterial(shader);`,
  ])("keeps built-in references, ordinary declarations, and unrelated source quiet", (code) => {
    expect(runRule(threeShaderNoReservedIdentifiers, code).diagnostics).toHaveLength(0);
  });
});
