import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderPreferSmallIntegerPow } from "./three-shader-prefer-small-integer-pow.js";

describe("three-shader-prefer-small-integer-pow", () => {
  it("reports powers of two, three, and four", () => {
    const code = `
      import * as THREE from "three";
      new THREE.ShaderMaterial({
        fragmentShader: "void main() { float x = pow(a, 2.0) + pow(b, 3) + pow(c, +4.); }",
      });
    `;

    expect(runRule(threeShaderPreferSmallIntegerPow, code).diagnostics).toHaveLength(3);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = pow(value, 0.7); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = pow(value, 5.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = pow(value, exponent); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#define pow(x, y) x\\nvoid main() { float x = pow(value, 2.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "float pow(float x, float y) { return x; } void main() { float x = pow(value, 2.0); }" });`,
  ])("keeps general, dynamic, and user-defined powers quiet %#", (code) => {
    expect(runRule(threeShaderPreferSmallIntegerPow, code).diagnostics).toHaveLength(0);
  });
});
