import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoNullLoaderInput } from "./r3f-no-null-loader-input.js";

describe("r3f-no-null-loader-input", () => {
  it("reports nullish R3F useLoader inputs across public entry points", () => {
    const code = `
      import { useLoader } from "@react-three/fiber";
      import * as NativeFiber from "@react-three/fiber/native";
      useLoader(TextureLoader, null);
      NativeFiber.useLoader(TextureLoader, undefined);
      useLoader(TextureLoader, void missingUrl);
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports conditional, optional, array, object, and const-aliased Drei inputs", () => {
    const code = `
      import { useGLTF, useTexture, useCubeTexture } from "@react-three/drei";
      const modelUrl = enabled ? url : null;
      const selectedUrl = modelUrl;
      useGLTF(selectedUrl);
      useGLTF(asset?.url);
      useCubeTexture([px, nx, undefined, ny, pz, nz]);
      useTexture({ map: colorUrl, normalMap: enabled ? normalUrl : null });
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(4);
  });

  it.each([
    `const { useGLTF } = require("@react-three/drei"); useGLTF(null);`,
    `const Drei = require("@react-three/drei"); Drei.useGLTF(null);`,
    `const loadModel = require("@react-three/drei").useGLTF; loadModel(null);`,
  ])("reports nullish inputs through CommonJS Drei provenance", (code) => {
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("models reachable logical and conditional branches", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const missingUrl = null;
      const aliasedMissingUrl = missingUrl;
      useGLTF(url || null);
      useGLTF(url ?? null);
      useGLTF(aliasedMissingUrl ?? null);
      useGLTF(url && null);
      useGLTF(false && null);
      useGLTF(true || null);
      useGLTF(null || url);
      useGLTF(undefined ?? url);
      useGLTF(true ? url : null);
      useGLTF(false ? null : url);
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("checks both reachable sides of logical AND inputs", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const modelUrl = null;
      useGLTF(modelUrl && fallbackUrl);
      useGLTF(asset?.url && fallbackUrl);
      useGLTF(maybeUrl && fallbackUrl);
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("prunes unreachable nullish branches through const truthiness", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const enabled = true;
      const disabled = false;
      const modelUrl = "/model.glb";
      const shouldLoad = enabled;
      const assetUrl = modelUrl;
      useGLTF(shouldLoad ? assetUrl : null);
      useGLTF(assetUrl ?? null);
      useGLTF(enabled && modelUrl);
      useGLTF(disabled && null);
      useGLTF(enabled || null);
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("propagates truthiness through logical and conditional expressions", () => {
    const code = `
      import { useGLTF } from "@react-three/drei";
      const alwaysEnabled = true;
      const alwaysDisabled = false;
      const modelUrl = "/model.glb";
      useGLTF((alwaysEnabled && modelUrl) || null);
      useGLTF((alwaysDisabled || modelUrl) || null);
      useGLTF((!alwaysDisabled && modelUrl) || null);
      useGLTF((enabled ? modelUrl : "/fallback.glb") || null);
      useGLTF((enabled || modelUrl) || null);
      useGLTF((enabled && modelUrl) || null);
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows real asset inputs and nullish values in later arguments", () => {
    const code = `
      import { useLoader } from "@react-three/fiber";
      import { useGLTF, useTexture } from "@react-three/drei";
      useLoader(TextureLoader, url);
      useLoader(TextureLoader, [colorUrl, normalUrl]);
      useGLTF(isMobile ? mobileUrl : desktopUrl);
      useGLTF(url, false, true, undefined);
      useTexture(url, null);
      useTexture({ map: colorUrl, normalMap: normalUrl });
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores nullable Drei APIs, unrelated hooks, and shadowed undefined", () => {
    const code = `
      import { useSpriteLoader, useVideoTexture, useMatcapTexture } from "@react-three/drei";
      import { useGLTF as useOtherGLTF } from "model-library";
      useSpriteLoader(null);
      useVideoTexture(null);
      useMatcapTexture(null);
      useOtherGLTF(null);
      function load(undefined) {
        const useGLTF = (value) => value;
        useGLTF(undefined);
      }
    `;
    const result = runRule(r3fNoNullLoaderInput, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
