import { describe, expect, it } from "vite-plus/test";
import { parseGlslShaderSource } from "./parse-glsl-shader-source.js";

describe("parse-glsl-shader-source", () => {
  it("ignores conditional directives inside comments", () => {
    expect(
      parseGlslShaderSource(
        "/* #ifdef COMMENTED */\n// #if 0\nvoid main() { gl_Position = vec4(0.0); }",
        "vertex",
      ),
    ).not.toBeNull();
  });

  it("rejects active conditional directives", () => {
    expect(
      parseGlslShaderSource(
        "#ifdef ACTIVE\nvoid main() { gl_Position = vec4(0.0); }\n#endif",
        "vertex",
      ),
    ).toBeNull();
  });
});
