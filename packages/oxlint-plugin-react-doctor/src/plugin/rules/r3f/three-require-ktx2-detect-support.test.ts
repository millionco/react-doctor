import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireKtx2DetectSupport } from "./three-require-ktx2-detect-support.js";

describe("three-require-ktx2-detect-support", () => {
  it("reports load calls before support detection", () => {
    const code = `
      import { KTX2Loader as Loader } from "three/addons/loaders/KTX2Loader.js";
      const first = new Loader();
      first.load("map.ktx2", onLoad, undefined, onError);
      const second = new Loader();
      second.loadAsync("map.ktx2");
      second.detectSupport(renderer);
    `;
    expect(runRule(threeRequireKtx2DetectSupport, code).diagnostics).toHaveLength(2);
  });

  it("allows prior sync or async detection and unrelated loaders", () => {
    const code = `
      import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
      import { KTX2Loader as Other } from "texture-kit";
      const sync = new KTX2Loader();
      sync.detectSupport(renderer);
      sync.loadAsync("map.ktx2");
      const asyncLoader = new KTX2Loader();
      await asyncLoader.detectSupportAsync(renderer);
      await asyncLoader.loadAsync("map.ktx2");
      new Other().loadAsync("map.ktx2");
    `;
    expect(runRule(threeRequireKtx2DetectSupport, code).diagnostics).toHaveLength(0);
  });
});
