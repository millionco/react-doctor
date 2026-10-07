import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidDataTextureDimensions } from "./three-valid-data-texture-dimensions.js";

describe("three-valid-data-texture-dimensions", () => {
  it.each([
    `import { DataTexture } from "three"; new DataTexture(data, 0, 8);`,
    `import * as THREE from "three"; new THREE.DataTexture(data, 8, -1);`,
    `import { Data3DTexture } from "three"; new Data3DTexture(data, 4, 4, 1.5);`,
    `import { DataArrayTexture } from "three"; const width = 2; new DataArrayTexture(data, width, 3.2, 4);`,
  ])("reports statically invalid data-texture dimensions", (code) => {
    expect(runRule(threeValidDataTextureDimensions, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { DataTexture } from "three"; new DataTexture(data, 8, 8);`,
    `import { Data3DTexture } from "three"; new Data3DTexture(data, 4, 4, 4);`,
    `import { DataTexture } from "three"; new DataTexture(data, width, height);`,
    `class DataTexture {} new DataTexture(data, 0, 0);`,
  ])("keeps valid, dynamic, and unrelated dimensions quiet", (code) => {
    expect(runRule(threeValidDataTextureDimensions, code).diagnostics).toHaveLength(0);
  });
});
