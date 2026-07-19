import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoMutateLoaderCache } from "./r3f-no-mutate-loader-cache.js";

describe("r3f-no-mutate-loader-cache", () => {
  it("reports destructive mutations of cached loader values and descendants", () => {
    const code = `
      import { useLoader } from "@react-three/fiber";
      import { useGLTF, useTexture } from "@react-three/drei";
      const loaded = useLoader(GLTFLoader, url);
      const { nodes, scene } = useGLTF(url);
      const texture = useTexture(textureUrl);
      const geometry = nodes.Mesh.geometry;
      geometry.center();
      scene.add(new Mesh());
      scene.clear();
      loaded.scene.remove(loaded.scene.children[0]);
      nodes.Mesh.material = replacementMaterial;
      loaded.scene.geometry = replacementGeometry;
      texture.applyMatrix4(matrix);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(7);
  });

  it("resolves import aliases, namespaces, hook aliases, and cached value aliases", () => {
    const code = `
      import { useLoader as loadAsset } from "@react-three/fiber/native";
      import * as Drei from "@react-three/drei/native";
      const loadModel = Drei.useGLTF;
      const first = loadAsset(TextureLoader, url);
      const firstAlias = first;
      const second = loadModel(modelUrl);
      firstAlias.translate(1, 0, 0);
      second.scene.rotateY(1);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(2);
  });

  it("tracks cached values through Object.values callbacks", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      interface GLTF { nodes: Record<string, Mesh> }
      const { nodes } = useGLTF(url) as GLTF;
      Object.values(nodes).forEach((node) => node.geometry?.center());
      Object.values(nodes).map((node) => node.material).forEach((material) => material.dispose());
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(1);
  });

  it("allows cloned values and mutations unrelated to loader cache values", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
      const loaded = useGLTF(url);
      const sceneClone = loaded.scene.clone();
      const skeletonClone = cloneSkeleton(loaded.scene);
      sceneClone.add(child);
      skeletonClone.clear();
      sceneClone.material = material;
      localGeometry.center();
      localScene.remove(child);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(0);
  });

  it("preserves shallow-clone provenance for shared geometry and material descendants", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
      import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
      const model = useGLTF(url);
      const clone = model.scene.clone();
      const skeletonClone = SkeletonUtils.clone(model.scene);
      const addonsClone = cloneSkeleton(model.scene);
      clone.geometry.center();
      clone.children[0].geometry.translate(1, 0, 0);
      skeletonClone.material.applyMatrix4(matrix);
      addonsClone.children[0].geometry.center();
      clone.position.set(1, 2, 3);
      clone.rotation.x = 1;
      clone.scale.setScalar(2);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(4);
  });

  it("tracks shared texture slots but not owned values on material clones", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const { materials } = useGLTF(url);
      const materialClone = materials.Body.clone();
      materialClone.map.repeat.set(2, 2);
      materialClone.normalMap.offset.copy(offset);
      materialClone.color.set(color);
      materialClone.normalScale.set(1, 1);
      materialClone.opacity = 0.5;
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(2);
  });

  it("reports common mutations of known cached Three.js value descendants", () => {
    const code = `
      import { useGLTF, useTexture } from "@react-three/drei";
      const model = useGLTF(url);
      const texture = useTexture(textureUrl);
      model.scene.position.set(1, 2, 3);
      model.scene.position.copy(targetPosition);
      model.scene.scale.setScalar(2);
      texture.repeat.set(2, 2);
      texture.offset.lerp(targetOffset, 0.5);
      model.scene.rotation.x = Math.PI;
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(6);
  });

  it("tracks cached descendants through inline traversal callbacks", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const { scene } = useGLTF(url);
      scene.traverse((child) => {
        child.castShadow = true;
        child.material.color.set("hotpink");
      });
      scene.traverseVisible((child) => { child.visible = false; });
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(3);
  });

  it("reports reparenting a cached object through an owned parent", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      import { useThree } from "@react-three/fiber";
      const { scene: model } = useGLTF(url);
      const root = useThree((state) => state.scene);
      root.add(model);
      root.attach(model);
      root.remove(model);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(3);
  });

  it("reports common cached material, object, and texture scalar mutations", () => {
    const code = `
      import { useGLTF, useTexture } from "@react-three/drei";
      const { materials, nodes } = useGLTF(url);
      const texture = useTexture(textureUrl);
      materials.Body.color.set("red");
      materials.Body.emissive.copy(glow);
      materials.Body.opacity = 0.5;
      materials.Body.roughness = 0.2;
      nodes.Mesh.receiveShadow = true;
      texture.colorSpace = colorSpace;
      texture.wrapS = wrapping;
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(7);
  });

  it("keeps owned traversal values, clones, and local reparenting quiet", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const { scene } = useGLTF(url);
      const clone = scene.clone();
      clone.traverse((child) => {
        child.position.set(1, 2, 3);
        child.material.clone().color.set("red");
      });
      localRoot.add(localObject);
      localRoot.add(scene.clone());
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(0);
  });

  it("keeps generic mutators quiet outside known cached mutable descendants", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const model = useGLTF(url);
      const clone = model.scene.clone();
      local.position.set(1, 2, 3);
      clone.position.set(1, 2, 3);
      clone.position.copy(targetPosition);
      clone.rotation.x = 1;
      model.scene.userData.vector.set(1, 2, 3);
      model.scene.configuration.copy(otherConfiguration);
      model.scene.configuration.set("visible", true);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(0);
  });

  it("recognizes every exact cached Drei loader hook", () => {
    const code = `
      import { useCubeTexture, useFBX, useFont, useKTX2 } from "@react-three/drei";
      const cube = useCubeTexture(files, { path });
      const fbx = useFBX(modelUrl);
      const font = useFont(fontUrl);
      const compressed = useKTX2(textureUrl);
      cube.repeat.set(2, 2);
      fbx.position.set(1, 2, 3);
      font.data.geometry = replacementGeometry;
      compressed.offset.set(0.5, 0.5);
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(4);
  });

  it("stays quiet for shadowed hooks, unrelated modules, and dynamic members", () => {
    const code = `
      import { useGLTF } from "other-loader";
      import * as Drei from "@react-three/drei";
      const propertyName = "scene";
      const unrelated = useGLTF(url);
      unrelated.scene.clear();
      function Component() {
        const useTexture = (value) => value;
        const texture = useTexture(url);
        texture.applyMatrix4(matrix);
      }
      const cached = Drei.useGLTF(url);
      cached[propertyName].clear();
      function Object() {}
      Object.values(cached.nodes).forEach((node) => node.geometry.center());
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(0);
  });

  it("does not double-report disposal through the mutation rule", () => {
    const code = `
      import { useTexture } from "@react-three/drei";
      const texture = useTexture(url);
      texture.dispose();
    `;
    expect(runRule(r3fNoMutateLoaderCache, code).diagnostics).toHaveLength(0);
  });
});
