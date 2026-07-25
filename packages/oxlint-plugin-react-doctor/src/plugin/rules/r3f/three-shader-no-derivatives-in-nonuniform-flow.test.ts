import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoDerivativesInNonuniformFlow } from "./three-shader-no-derivatives-in-nonuniform-flow.js";

describe("three-shader-no-derivatives-in-nonuniform-flow", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "varying vec2 vUv; void main() { if (vUv.x > 0.5) { float edge = fwidth(vUv.x); gl_FragColor = vec4(edge); } }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main() { vec4 color = vUv.x > 0.5 ? texture2D(map, vUv) : vec4(0.0); gl_FragColor = color; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { while (gl_FragCoord.x > 0.0) { float edge = dFdx(gl_FragCoord.y); break; } gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "varying float enabled; void main() { bool result = enabled > 0.0 && fwidth(enabled) > 0.1; gl_FragColor = vec4(result); }" });`,
  ])("reports derivatives in proven fragment-dependent control flow", (code) => {
    expect(runRule(threeShaderNoDerivativesInNonuniformFlow, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform bool enabled; varying vec2 vUv; void main() { if (enabled) { float edge = fwidth(vUv.x); gl_FragColor = vec4(edge); } }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "varying vec2 vUv; void main() { float edge = fwidth(vUv.x); if (vUv.x > 0.5) gl_FragColor = vec4(edge); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "varying vec2 vUv; void main() { vec2 dx = dFdx(vUv); vec4 color = textureGrad(map, vUv, dx, dFdy(vUv)); gl_FragColor = color; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "float fwidth(float value) { return value; } varying float value; void main() { if (value > 0.0) gl_FragColor = vec4(fwidth(value)); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "attribute float value; void main() { if (value > 0.0) gl_Position = vec4(fwidth(value)); }" });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "varying float value; void main() { if (value > 0.0) gl_FragColor = vec4(fwidth(value)); }" });`,
  ])(
    "keeps uniform flow, hoisted work, explicit gradients, shadowed calls, vertex shaders, and unrelated constructors quiet",
    (code) => {
      expect(runRule(threeShaderNoDerivativesInNonuniformFlow, code).diagnostics).toHaveLength(0);
    },
  );
});
