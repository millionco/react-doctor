import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderNoInvalidSmoothstepEdges } from "./three-shader-no-invalid-smoothstep-edges.js";

describe("three-shader-no-invalid-smoothstep-edges", () => {
  it("reports reversed and equal scalar edges in static Three.js shaders", () => {
    const code = `
      import * as THREE from "three";
      const shared = "float first = smoothstep(1.0, 0.0, value);";
      const fragmentShader = [
        "void main() {",
        shared,
        "float second = smoothstep(+2, -2, value);",
        "}"
      ].join("\\n");
      new THREE.ShaderMaterial({
        vertexShader: "void main() { float third = smoothstep(4., 4.0, value); }",
        fragmentShader,
      });
    `;

    expect(runRule(threeShaderNoInvalidSmoothstepEdges, code).diagnostics).toHaveLength(3);
  });

  it.each([
    `import { ShaderMaterial as Material } from "three"; new Material({ fragmentShader: \`void main() { float x = smoothstep(1.0, 0.0, value); }\` });`,
    `import { RawShaderMaterial } from "three"; const shader = "void main() {" + "float x = smoothstep(2, 1, value);" + "}"; new RawShaderMaterial({ fragmentShader: shader });`,
    `import THREE = require("three"); const options = { ["fragmentShader"]: "void main() { float x = smoothstep(1, 0, value); }" }; new THREE.ShaderMaterial(options);`,
  ])("supports Three constructor and static source aliases %#", (code) => {
    expect(runRule(threeShaderNoInvalidSmoothstepEdges, code).diagnostics).toHaveLength(1);
  });

  it("uses the final authoritative shader property", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        fragmentShader: "void main() { float x = smoothstep(1, 0, value); }",
        fragmentShader: "void main() { float x = smoothstep(0, 1, value); }",
      });
    `;

    expect(runRule(threeShaderNoInvalidSmoothstepEdges, code).diagnostics).toHaveLength(0);
  });

  it("parses around Three include directives while preserving shader offsets", () => {
    const code = `
      import { ShaderMaterial } from "three";
      new ShaderMaterial({
        fragmentShader: \`
          #include <common>
          void main() {
            #include <color_fragment>
            float x = smoothstep(1, 0, value);
          }
        \`,
      });
    `;

    expect(runRule(threeShaderNoInvalidSmoothstepEdges, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(0, 1, value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(edge0, edge1, value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { vec3 x = smoothstep(vec3(1), vec3(0), value); }" });`,
    `import { ShaderMaterial } from "three"; const edge = 1; new ShaderMaterial({ fragmentShader: \`void main() { float x = smoothstep(\${edge}, 0, value); }\` });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#if REVERSE\\nvoid main() { float x = smoothstep(1, 0, value); }\\n#endif" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#define smoothstep(a, b, x) customStep(a, b, x)\\nvoid main() { float x = smoothstep(1, 0, value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "float smoothstep(float a, float b, float x) { return a; } void main() { float x = smoothstep(1, 0, value); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "not valid glsl smoothstep(1, 0, value)" });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(1, 0, value); }" });`,
    `import { ShaderMaterial } from "three"; { class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(1, 0, value); }" }); }`,
    `import { ShaderMaterial } from "other"; new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(1, 0, value); }" });`,
    `import { ShaderMaterial } from "three"; import fragmentShader from "./shader.glsl"; new ShaderMaterial({ fragmentShader });`,
    `import { ShaderMaterial } from "three"; const extra = {}; new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(1, 0, value); }", ...extra });`,
    `import { ShaderMaterial } from "three"; const key = getKey(); new ShaderMaterial({ fragmentShader: "void main() { float x = smoothstep(1, 0, value); }", [key]: replacement });`,
  ])("keeps valid, dynamic, conditional, and unproven shaders quiet", (code) => {
    expect(runRule(threeShaderNoInvalidSmoothstepEdges, code).diagnostics).toHaveLength(0);
  });
});
