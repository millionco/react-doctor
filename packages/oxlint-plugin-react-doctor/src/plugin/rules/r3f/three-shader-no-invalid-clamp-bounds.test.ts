import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoInvalidClampBounds } from "./three-shader-no-invalid-clamp-bounds.js";

describe("three-shader-no-invalid-clamp-bounds", () => {
  it("reports reversed scalar clamp bounds in both shader stages", () => {
    const code = `
      import * as THREE from "three";
      new THREE.ShaderMaterial({
        vertexShader: "void main() { float x = clamp(value, +2.0, -1.0); }",
        fragmentShader: "void main() { float x = clamp(value, 4, 3); }",
      });
    `;

    expect(runRule(threeShaderNoInvalidClampBounds, code).diagnostics).toHaveLength(2);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = clamp(value, 0, 1); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = clamp(value, 1, 1); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = clamp(value, minimum, maximum); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#define clamp(x, a, b) x\\nvoid main() { float x = clamp(value, 2, 1); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "float clamp(float x, float a, float b) { return x; } void main() { float x = clamp(value, 2, 1); }" });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "void main() { float x = clamp(value, 2, 1); }" });`,
  ])("keeps defined, dynamic, shadowed, and unrelated clamp calls quiet %#", (code) => {
    expect(runRule(threeShaderNoInvalidClampBounds, code).diagnostics).toHaveLength(0);
  });
});
