import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoDisposeLoaderCache } from "./r3f-no-dispose-loader-cache.js";

describe("r3f-no-dispose-loader-cache", () => {
  it("reports direct disposal of cached loader values and known descendants", () => {
    const code = `
      import { useLoader } from "@react-three/fiber";
      import { useGLTF, useTexture } from "@react-three/drei";
      const texture = useTexture(url);
      const model = useGLTF(modelUrl);
      const loaded = useLoader(TextureLoader, otherUrl);
      const textureArray = useTexture([firstUrl, secondUrl]);
      const geometry = model.nodes.Mesh.geometry;
      texture.dispose();
      model.scene.dispose();
      geometry.dispose();
      loaded.dispose();
      textureArray[0].dispose();
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(5);
  });

  it("resolves aliases and namespace imports", () => {
    const code = `
      import { useLoader as load } from "@react-three/fiber/webgpu";
      import * as Drei from "@react-three/drei";
      const loadTexture = Drei.useTexture;
      const first = load(TextureLoader, url);
      const second = loadTexture(otherUrl);
      const secondAlias = second;
      first.dispose();
      secondAlias.dispose();
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(2);
  });

  it("recognizes every exact cached Drei loader hook", () => {
    const code = `
      import { useCubeTexture, useFBX, useFont, useKTX2 } from "@react-three/drei/native";
      useCubeTexture(files, { path }).dispose();
      useFBX(modelUrl).geometry.dispose();
      useFont(fontUrl).data.dispose();
      useKTX2(textureUrl).dispose();
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(4);
  });

  it("preserves shallow-clone provenance only for shared resource descendants", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      import * as SkeletonUtils from "three/addons/utils/SkeletonUtils";
      const model = useGLTF(url);
      const clone = model.scene.clone();
      const skeletonClone = SkeletonUtils.clone(model.scene);
      clone.geometry.dispose();
      clone.children[0].material.dispose();
      skeletonClone.children[0].material.dispose();
      clone.dispose();
      skeletonClone.dispose();
      clone.position.dispose();
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(3);
  });

  it("preserves cached texture-slot provenance through a shallow material clone", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const { materials } = useGLTF(url);
      const materialClone = materials.Body.clone();
      materialClone.map.dispose();
      materialClone.normalMap.dispose();
      materialClone.dispose();
      materialClone.color.dispose();
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(2);
  });

  it("allows cloned resources and locally owned resources", () => {
    const code = `
      import { useGLTF, useTexture } from "@react-three/drei";
      import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
      const model = useGLTF(url);
      const texture = useTexture(textureUrl);
      const sceneClone = model.scene.clone();
      const skeletonClone = SkeletonUtils.clone(model.scene);
      const textureClone = texture.clone();
      sceneClone.dispose();
      skeletonClone.dispose();
      textureClone.dispose();
      new CanvasTexture(canvas).dispose();
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet for shadowed hooks, dynamic descendants, and imported cleanup helpers", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      import { disposeAsset } from "./cleanup";
      const model = useGLTF(url);
      const key = "scene";
      disposeAsset(model);
      model[key].dispose();
      function Preview() {
        const useGLTF = (value) => value;
        const local = useGLTF(url);
        local.dispose();
      }
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(0);
  });

  it("reports disposal inside a nested cleanup when provenance remains exact", () => {
    const code = `
      import { useTexture } from "@react-three/drei";
      import { useEffect } from "react";
      const Component = () => {
        const texture = useTexture(url);
        useEffect(() => () => texture.dispose(), [texture]);
      };
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(1);
  });

  it("reports cached descendant disposal inside inline traversal callbacks", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const { scene } = useGLTF(url);
      scene.traverse((child) => {
        child.geometry.dispose();
        child.material.dispose();
      });
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(2);
  });

  it("keeps clone-owned traversal values quiet while preserving shared resources", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const clone = useGLTF(url).scene.clone();
      clone.traverse((child) => {
        child.position.dispose();
        child.geometry.dispose();
      });
    `;
    expect(runRule(r3fNoDisposeLoaderCache, code).diagnostics).toHaveLength(1);
  });
});
