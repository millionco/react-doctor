import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderPreferSquaredDistanceComparison } from "./three-shader-prefer-squared-distance-comparison.js";

describe("three-shader-prefer-squared-distance-comparison", () => {
  it("reports direct ordering comparisons against nonnegative constants", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        fragmentShader: \`
          void main() {
            bool near = length(position) < 2.0;
            bool far = 3.0 <= distance(first, second);
          }
        \`,
      });
    `;

    expect(runRule(threeShaderPreferSquaredDistanceComparison, code).diagnostics).toHaveLength(2);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float d = length(value); bool x = d < 2.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { bool x = length(value) == 2.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { bool x = length(value) < threshold; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { bool x = length(value) < -1.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "float length(float x) { return x; } void main() { bool x = length(value) < 2.0; }" });`,
  ])(
    "keeps reused, equality, dynamic, impossible, and user-defined comparisons quiet %#",
    (code) => {
      expect(runRule(threeShaderPreferSquaredDistanceComparison, code).diagnostics).toHaveLength(0);
    },
  );
});
