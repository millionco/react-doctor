import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidDataTextureDataLength } from "./three-valid-data-texture-data-length.js";

describe("three-valid-data-texture-data-length", () => {
  it.each([
    `import { DataTexture } from "three"; new DataTexture(new Uint8Array(15), 2, 2);`,
    `import { DataTexture, RedFormat } from "three"; new DataTexture(new Float32Array([1, 2, 3]), 2, 2, RedFormat);`,
    `import * as THREE from "three"; const data = new Float32Array(31); new THREE.Data3DTexture(data, 2, 2, 2);`,
    `import { DataArrayTexture, RGFormat } from "three"; new DataArrayTexture(new Uint8Array(23), 2, 2, 3, RGFormat);`,
  ])("reports statically undersized data-texture storage", (code) => {
    expect(runRule(threeValidDataTextureDataLength, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { DataTexture } from "three"; new DataTexture(new Uint8Array(16), 2, 2);`,
    `import { DataTexture, RedFormat } from "three"; new DataTexture(new Float32Array(4), 2, 2, RedFormat);`,
    `import { DataTexture, RGBAFormat, UnsignedShort4444Type } from "three"; new DataTexture(new Uint16Array(4), 2, 2, RGBAFormat, UnsignedShort4444Type);`,
    `import { DataTexture } from "three"; new DataTexture(data, width, height);`,
    `import { DataTexture } from "three"; new DataTexture(null, 2, 2);`,
    `class DataTexture {} new DataTexture(new Uint8Array(1), 2, 2);`,
  ])("keeps sufficient, packed, dynamic, empty, and unrelated storage quiet", (code) => {
    expect(runRule(threeValidDataTextureDataLength, code).diagnostics).toHaveLength(0);
  });
});
