import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoRedundantFragDepth } from "./three-shader-no-redundant-frag-depth.js";

describe("three-shader-no-redundant-frag-depth", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { gl_FragDepth = gl_FragCoord.z; }" });`,
    `import { RawShaderMaterial } from "three"; new RawShaderMaterial({ fragmentShader: "void main() { gl_FragDepthEXT = gl_FragCoord.z; }" });`,
  ])("reports a sole unconditional fixed-function depth write %#", (code) => {
    expect(runRule(threeShaderNoRedundantFragDepth, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { gl_FragDepth = customDepth; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { if (enabled) gl_FragDepth = gl_FragCoord.z; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { if (enabled) gl_FragDepth = customDepth; else gl_FragDepth = gl_FragCoord.z; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void helper() { gl_FragDepth = gl_FragCoord.z; } void main() {}" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position = vec4(0.0); }" });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "void main() { gl_FragDepth = gl_FragCoord.z; }" });`,
  ])("keeps meaningful, conditional, helper, absent, and unrelated writes quiet %#", (code) => {
    expect(runRule(threeShaderNoRedundantFragDepth, code).diagnostics).toHaveLength(0);
  });
});
