import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireLoaderErrorHandling } from "./three-require-loader-error-handling.js";

describe("three-require-loader-error-handling", () => {
  it("reports callback loads without onError and discarded async loads", () => {
    const code = `
      import { TextureLoader } from "three";
      import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
      const textureLoader = new TextureLoader();
      const modelLoader = new GLTFLoader();
      textureLoader.load("/texture.png", onLoad);
      void modelLoader.loadAsync("/model.glb");
    `;
    expect(runRule(threeRequireLoaderErrorHandling, code).diagnostics).toHaveLength(2);
  });

  it("allows explicit callbacks and propagated async rejections", () => {
    const code = `
      import * as THREE from "three";
      import { TextureLoader } from "three";
      const loader = new TextureLoader();
      loader.load("/texture.png", onLoad, undefined, onError);
      const load = async () => await loader.loadAsync("/texture.png");
      const forward = () => loader.loadAsync("/other.png");
      const promise = loader.loadAsync("/saved.png");
      const manager = new THREE.LoadingManager(undefined, undefined, onError);
      const managedLoader = new THREE.TextureLoader(manager);
      managedLoader.load("/managed.png", onLoad);
    `;
    expect(runRule(threeRequireLoaderErrorHandling, code).diagnostics).toHaveLength(0);
  });

  it("ignores lookalike and unresolved loaders", () => {
    const code = `
      class TextureLoader { load() {} loadAsync() {} }
      new TextureLoader().load("/texture.png", onLoad);
      loader.load("/model.glb", onLoad);
      loader.loadAsync("/model.glb");
    `;
    expect(runRule(threeRequireLoaderErrorHandling, code).diagnostics).toHaveLength(0);
  });
});
