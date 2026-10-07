import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderValidUniformDefinitions } from "./three-shader-valid-uniform-definitions.js";

describe("three-shader-valid-uniform-definitions", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { uTime: 1 } });`,
    `import * as THREE from "three"; new THREE.RawShaderMaterial({ uniforms: { uColor: [1, 0, 0] } });`,
    `import { ShaderMaterial } from "three"; const definition = {}; const uniforms = { uMissing: definition }; new ShaderMaterial({ uniforms });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { ["uTime"]: () => 1 } });`,
  ])("reports uniform entries without a value container", (code) => {
    expect(runRule(threeShaderValidUniformDefinitions, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { uTime: { value: 1 } } });`,
    `import { RawShaderMaterial, Uniform } from "three"; new RawShaderMaterial({ uniforms: { uTime: new Uniform(1) } });`,
    `import * as THREE from "three"; const value = new THREE.Uniform(1); new THREE.ShaderMaterial({ uniforms: { uTime: value } });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: getUniforms() });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { uTime: makeUniform() } });`,
    `import { ShaderMaterial } from "three"; const shared = getShared(); new ShaderMaterial({ uniforms: { ...shared, uTime: { value: 1 } } });`,
    `class ShaderMaterial {}; new ShaderMaterial({ uniforms: { uTime: 1 } });`,
    `import { ShaderMaterial } from "other"; new ShaderMaterial({ uniforms: { uTime: 1 } });`,
  ])("keeps valid and unresolved uniform definitions quiet", (code) => {
    expect(runRule(threeShaderValidUniformDefinitions, code).diagnostics).toHaveLength(0);
  });

  it("uses the final authoritative uniform entry", () => {
    const valid = `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { uTime: 1, uTime: { value: 1 } } });`;
    const invalid = `import { ShaderMaterial } from "three"; new ShaderMaterial({ uniforms: { uTime: { value: 1 }, uTime: 1 } });`;

    expect(runRule(threeShaderValidUniformDefinitions, valid).diagnostics).toHaveLength(0);
    expect(runRule(threeShaderValidUniformDefinitions, invalid).diagnostics).toHaveLength(1);
  });
});
