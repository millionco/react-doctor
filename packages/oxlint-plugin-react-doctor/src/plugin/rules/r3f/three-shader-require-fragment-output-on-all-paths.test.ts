import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeShaderRequireFragmentOutputOnAllPaths } from "./three-shader-require-fragment-output-on-all-paths.js";

describe("three-shader-require-fragment-output-on-all-paths", () => {
  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform bool enabled; void main() { if (enabled) gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { gl_FragColor.rgb = vec3(1.0); }" });`,
    `import { ShaderMaterial, GLSL3 } from "three"; new ShaderMaterial({ glslVersion: GLSL3, fragmentShader: "out vec4 color; uniform bool enabled; void main() { if (!enabled) return; color = vec4(1.0); }" });`,
    `import { RawShaderMaterial, GLSL3 } from "three"; new RawShaderMaterial({ glslVersion: GLSL3, fragmentShader: "precision highp float; out vec4 color; void main() { color.rg = vec2(1.0); color.b = 1.0; }" });`,
  ])("reports partially or conditionally written color outputs", (code) => {
    expect(runRule(threeShaderRequireFragmentOutputOnAllPaths, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform bool enabled; void main() { if (enabled) gl_FragColor = vec4(1.0); else gl_FragColor = vec4(0.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "uniform bool enabled; void main() { if (!enabled) discard; gl_FragColor = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void main() { gl_FragColor.rgb = vec3(1.0); gl_FragColor.a = 1.0; }" });`,
    `import { ShaderMaterial, GLSL3 } from "three"; new ShaderMaterial({ glslVersion: GLSL3, fragmentShader: "out vec4 color; void main() { color = vec4(1.0); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "void writeColor() { gl_FragColor = vec4(1.0); } void main() { writeColor(); }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader: "#define WRITE_COLOR gl_FragColor = vec4(1.0)\nvoid main() { WRITE_COLOR; }" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ colorWrite: false, fragmentShader: "void main() {}" });`,
    `import { ShaderMaterial } from "three"; new ShaderMaterial({ fragmentShader });`,
    `class ShaderMaterial {}; new ShaderMaterial({ fragmentShader: "void main() { if (enabled) gl_FragColor = vec4(1.0); }" });`,
  ])("keeps complete, discarded, delegated, depth-only, and unresolved shaders quiet", (code) => {
    expect(runRule(threeShaderRequireFragmentOutputOnAllPaths, code).diagnostics).toHaveLength(0);
  });
});
