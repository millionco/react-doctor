import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeTextureRepeatRequiresWrapping } from "./three-texture-repeat-requires-wrapping.js";

describe("three-texture-repeat-requires-wrapping", () => {
  it("reports repeated axes that retain clamp wrapping", () => {
    const code = `
      import { RepeatWrapping, Texture } from "three";
      const both = new Texture();
      both.repeat.set(4, 2);
      const vertical = new Texture();
      vertical.wrapS = RepeatWrapping;
      vertical.repeat.set(4, 3);
    `;
    expect(runRule(threeTextureRepeatRequiresWrapping, code).diagnostics).toHaveLength(3);
  });

  it("allows matching wrapping, defaults, dynamic, and unrelated textures", () => {
    const code = `
      import { MirroredRepeatWrapping, RepeatWrapping, Texture } from "three";
      const texture = new Texture();
      texture.wrapS = RepeatWrapping;
      texture.wrapT = MirroredRepeatWrapping;
      texture.repeat.set(4, 2);
      const defaults = new Texture();
      defaults.repeat.set(1, 1);
      const dynamic = new Texture();
      dynamic.repeat.set(x, y);
      custom.repeat.set(4, 4);
    `;
    expect(runRule(threeTextureRepeatRequiresWrapping, code).diagnostics).toHaveLength(0);
  });
});
