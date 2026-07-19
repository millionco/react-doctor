import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fPreferUseLoader } from "./r3f-prefer-use-loader.js";

describe("r3f-prefer-use-loader", () => {
  it("requires the first Fiber major that exposes useLoader", () => {
    expect(r3fPreferUseLoader.requires).toEqual(["r3f:3"]);
  });

  it("reports core Three.js loader calls in React effects", () => {
    const code = `
      import { useThree } from "@react-three/fiber";
      import { useEffect, useLayoutEffect } from "react";
      import { TextureLoader } from "three";
      import * as THREE from "three";

      const Preview = ({ url }) => {
        useThree();
        useEffect(() => {
          new TextureLoader().load(url, setTexture);
        }, [url]);
        useLayoutEffect(() => {
          const loader = new THREE.CubeTextureLoader();
          loader.loadAsync(urls).then(setEnvironment);
        }, [urls]);
        return <mesh />;
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(2);
  });

  it("reports example and three-stdlib loaders through immutable aliases", () => {
    const code = `
      import "@react-three/fiber";
      import { useEffect as runEffect } from "react";
      import { GLTFLoader as ModelLoader } from "three/addons/loaders/GLTFLoader.js";
      import { RGBELoader } from "three-stdlib";

      const modelLoader = new ModelLoader();
      const loaderAlias = modelLoader;
      const loadAssets = () => {
        loaderAlias.load(modelUrl, setModel);
        new RGBELoader().loadAsync(environmentUrl).then(setEnvironment);
      };

      const Preview = () => {
        runEffect(loadAssets, [modelUrl, environmentUrl]);
        return <group />;
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(2);
  });

  it("reports synchronous helpers called by an effect", () => {
    const code = `
      import { useThree } from "@react-three/fiber/native";
      import React from "react";
      import { TextureLoader } from "three";

      const loader = new TextureLoader();
      const loadTexture = () => loader.load(url, setTexture);
      const Preview = () => {
        useThree();
        React.useEffect(() => {
          loadTexture();
        }, [url]);
        return null;
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(1);
  });

  it("allows R3F useLoader and imperative work outside effects", () => {
    const code = `
      import { useLoader } from "@react-three/fiber";
      import { TextureLoader } from "three";

      const loader = new TextureLoader();
      const cachedTexture = useLoader(TextureLoader, url);
      loader.load(moduleUrl, setModuleTexture);

      const Preview = () => {
        const onClick = () => loader.load(clickUrl, setClickedTexture);
        return <button onClick={onClick}>{cachedTexture.name}</button>;
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(0);
  });

  it("allows deferred callbacks declared inside effects", () => {
    const code = `
      import { useThree } from "@react-three/fiber";
      import { useEffect } from "react";
      import { TextureLoader } from "three";

      const loader = new TextureLoader();
      const Preview = () => {
        useThree();
        useEffect(() => {
          const onMessage = () => loader.load(nextUrl, setTexture);
          window.addEventListener("message", onMessage);
          const timeoutId = setTimeout(() => loader.load(fallbackUrl, setTexture), 100);
          return () => {
            window.removeEventListener("message", onMessage);
            clearTimeout(timeoutId);
          };
        }, []);
        return <mesh />;
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(0);
  });

  it("ignores components outside the Canvas provider", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { useEffect } from "react";
      import { TextureLoader } from "three";
      const Preview = ({ url }) => {
        useEffect(() => {
          new TextureLoader().load(url, setTexture);
        }, [url]);
        return (
          <Canvas>
            <mesh />
          </Canvas>
        );
      };
      const WebComponentPreview = ({ url }) => {
        useEffect(() => {
          new TextureLoader().load(url, setTexture);
        }, [url]);
        return <model-preview />;
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(0);
  });

  it("ignores Three.js effects when R3F is not used", () => {
    const code = `
      import { useEffect } from "react";
      import { TextureLoader } from "three";
      useEffect(() => {
        new TextureLoader().load(url, setTexture);
      }, [url]);
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(0);
  });

  it("ignores custom, imported-instance, dynamic, and shadowed loaders", () => {
    const code = `
      import "@react-three/fiber";
      import { useEffect } from "react";
      import { TextureLoader as CustomLoader } from "custom-loaders";
      import { sharedLoader } from "./loaders";
      import { TextureLoader } from "three";

      const method = "load";
      useEffect(() => {
        new CustomLoader().load(url, setCustom);
        sharedLoader.load(url, setShared);
        new TextureLoader()[method](url, setDynamic);
      }, [url]);

      const nested = (useEffect, TextureLoader) => {
        useEffect(() => new TextureLoader().load(url, setNested), [url]);
      };
    `;
    expect(runRule(r3fPreferUseLoader, code).diagnostics).toHaveLength(0);
  });
});
