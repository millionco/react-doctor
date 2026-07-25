import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoInvalidConstantMath } from "./three-shader-no-invalid-constant-math.js";

describe("three-shader-no-invalid-constant-math", () => {
  it("reports constant arguments outside defined GLSL math domains", () => {
    const code = `
      import { RawShaderMaterial } from "three";
      new RawShaderMaterial({
        fragmentShader: \`
          void main() {
            float a = pow(-1.0, 2.0);
            float b = pow(0.0, 0.0);
            float c = sqrt(-1.0);
            float d = inversesqrt(0.0);
            float e = log(0.0);
            float f = log2(-2.0);
            float g = 1.0 / 0.0;
            float h = 1.0 % 0.0;
            float i = mod(value, 0.0);
            float j = asin(2.0);
            float k = acos(-2.0);
            float l = atan(0.0, 0.0);
            float m = acosh(0.5);
            float n = atanh(1.0);
            float o = ldexp(value, 129);
            float p = atanh(-1.0);
            g /= 0.0;
            h %= 0.0;
          }
        \`,
      });
    `;

    expect(runRule(threeShaderNoInvalidConstantMath, code).diagnostics).toHaveLength(18);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = pow(value, 0.0) + sqrt(value) + log(value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = pow(0.0, exponent) + mod(value, divisor); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = asin(1.0) + acos(-1.0) + atan(0.0, 1.0) + acosh(1.0) + atanh(-0.5) + ldexp(value, 128); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "float sqrt(float x) { return x; } void main() { float x = sqrt(-1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#define log(x) x\\nvoid main() { float x = log(0.0); }" });`,
    `import { ShaderMaterial } from "other"; new ShaderMaterial({ fragmentShader: "void main() { float x = sqrt(-1.0); }" });`,
  ])("keeps dynamic, user-defined, and unrelated math quiet %#", (code) => {
    expect(runRule(threeShaderNoInvalidConstantMath, code).diagnostics).toHaveLength(0);
  });
});
