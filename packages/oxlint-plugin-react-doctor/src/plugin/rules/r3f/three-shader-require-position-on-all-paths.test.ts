import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderRequirePositionOnAllPaths } from "./three-shader-require-position-on-all-paths.js";

describe("three-shader-require-position-on-all-paths", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { float value = 1.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform bool enabled; void main() { if (enabled) gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform bool enabled; void main() { if (enabled) return; gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { for (int index = 0; index < 1; index++) gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "/* #define SET_POSITION() gl_Position = vec4(0.0) */ void main() { float value = 1.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position.x = 0.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "#include <project_vertex>\\nvoid main() { float value = 1.0; }" });`,
  ])("reports a proven path without a position write", (code) => {
    expect(runRule(threeShaderRequirePositionOnAllPaths, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position.wzyx = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { float value; gl_Position = vec4(0.0), value = 1.0; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position.x = 0.0; gl_Position.yzw = vec3(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { gl_Position.x = 0.0, gl_Position.yzw = vec3(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform bool enabled; void main() { if (enabled) gl_Position = vec4(0.0); else gl_Position = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "uniform bool enabled; void main() { gl_Position = vec4(0.0); if (enabled) return; gl_Position = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { if (true) gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { vec4 position = (gl_Position = vec4(0.0)); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { for (int index = int((gl_Position = vec4(0.0)).x); index < 1; index++) {} }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { for (;;) gl_Position = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { if ((gl_Position = vec4(0.0)).x == 0.0) {} }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { while ((gl_Position = vec4(0.0)).x == 0.0) { break; } }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { sin((gl_Position = vec4(0.0)).x); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void setPosition() { gl_Position = vec4(0.0); } void main() { setPosition(); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "#define SET_POSITION() gl_Position = vec4(0.0)\\nvoid main() { SET_POSITION(); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: "void main() { #include <begin_vertex>\\n#include <project_vertex> }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ vertexShader: shader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ vertexShader: "void main() {}" });`,
  ])("keeps complete, currently unsupported, dynamic, and unrelated shaders quiet", (code) => {
    expect(runRule(threeShaderRequirePositionOnAllPaths, code).diagnostics).toHaveLength(0);
  });
});
