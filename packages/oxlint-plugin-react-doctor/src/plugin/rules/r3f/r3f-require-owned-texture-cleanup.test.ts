import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireOwnedTextureCleanup } from "./r3f-require-owned-texture-cleanup.js";

describe("r3f-require-owned-texture-cleanup", () => {
  it("reports locally constructed textures without cleanup", () => {
    const code = `
      import { CanvasTexture, DataTexture, VideoTexture } from "three";
      import { useMemo, useState } from "react";
      const Scene = ({ canvas, data, video }) => {
        const canvasTexture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const [dataTexture] = useState(() => new DataTexture(data));
        const videoTexture = new VideoTexture(video);
        return <meshStandardMaterial map={canvasTexture} alphaMap={dataTexture} emissiveMap={videoTexture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(3);
  });

  it("reports eager state-owned base textures that are replaced later", () => {
    const code = `
      import * as THREE from "three";
      import { useState } from "react";
      const Scene = ({ loadedTexture }) => {
        const [texture, setTexture] = useState(new THREE.Texture());
        if (loadedTexture) setTexture(loadedTexture);
        return <meshBasicMaterial map={texture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts a lazy state-owned base texture with cleanup", () => {
    const code = `
      import { Texture } from "three";
      import { useEffect, useState } from "react";
      const Scene = () => {
        const [texture] = useState(() => new Texture());
        useEffect(() => () => texture.dispose(), [texture]);
        return <meshBasicMaterial map={texture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("reports effect-owned textures when the effect does not return disposal", () => {
    const code = `
      import * as THREE from "three";
      import { useEffect } from "react";
      const useVideo = (video) => {
        useEffect(() => {
          const texture = new THREE.VideoTexture(video);
          texture.needsUpdate = true;
        }, [video]);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts cleanup for memoized, state-owned, render-owned, and effect-owned textures", () => {
    const code = `
      import { CanvasTexture as CT, DataTexture, VideoTexture } from "three";
      import React, { useEffect, useMemo, useState } from "react";
      const Scene = ({ canvas, data, video }) => {
        const canvasTexture = useMemo(() => new CT(canvas), [canvas]);
        const [dataTexture] = useState(() => new DataTexture(data));
        const videoTexture = new VideoTexture(video);
        useEffect(() => () => canvasTexture.dispose(), [canvasTexture]);
        React.useLayoutEffect(() => {
          const dataAlias = dataTexture;
          return () => dataAlias.dispose();
        }, []);
        useEffect(() => () => videoTexture.dispose(), [videoTexture]);
        useEffect(() => {
          const effectTexture = new VideoTexture(video);
          return () => effectTexture.dispose();
        }, [video]);
        return null;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("allows texture property mutation after valid cleanup registration", () => {
    const code = `
      import { CanvasTexture, DataTexture } from "three";
      import { useEffect, useMemo, useState } from "react";
      const Scene = ({ canvas, data }) => {
        let texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const [resources] = useState(() => ({ texture: new DataTexture(data) }));
        useEffect(() => () => texture.dispose(), [texture]);
        useEffect(() => () => resources.texture.dispose(), [resources]);
        texture.needsUpdate = true;
        texture.image.data = data;
        resources.texture.needsUpdate = true;
        return <><primitive object={texture} /><primitive object={resources.texture} /></>;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("still rejects direct and structured texture identity replacement", () => {
    const code = `
      import { CanvasTexture, DataTexture } from "three";
      import { useEffect, useMemo, useState } from "react";
      const Scene = ({ canvas, data, replacement }) => {
        let texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const [resources] = useState(() => ({ texture: new DataTexture(data) }));
        useEffect(() => () => texture.dispose(), [texture]);
        useEffect(() => () => resources.texture.dispose(), [resources]);
        texture = replacement;
        resources.texture = replacement;
        return <><primitive object={texture} /><primitive object={resources.texture} /></>;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(2);
  });

  it("requires changing texture owners to be tracked by cleanup dependencies", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        useEffect(() => () => texture.dispose(), []);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("accepts an empty cleanup dependency list for stable owners", () => {
    const code = `
      import { CanvasTexture, DataTexture } from "three";
      import { useEffect, useMemo, useState } from "react";
      const Scene = ({ canvas, data }) => {
        const stableCanvasTexture = useMemo(() => new CanvasTexture(canvas), []);
        const [stableDataTexture] = useState(() => new DataTexture(data));
        useEffect(() => () => stableCanvasTexture.dispose(), []);
        useEffect(() => () => stableDataTexture.dispose(), []);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("tracks useRef-owned textures through current and exact aliases", () => {
    const code = `
      import { CanvasTexture, DataTexture } from "three";
      import { useEffect, useRef } from "react";
      const DirectMissing = ({ canvas }) => {
        const textureRef = useRef(new CanvasTexture(canvas));
        return <primitive object={textureRef.current} />;
      };
      const LazyComplete = ({ data }) => {
        const textureRef = useRef(null);
        if (!textureRef.current) textureRef.current = new DataTexture(data);
        const texture = textureRef.current;
        useEffect(() => () => texture.dispose(), []);
        return <primitive object={texture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("recognizes cleanup through a structured state-factory resource path", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useEffect, useState } from "react";
      const Scene = ({ canvas }) => {
        const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
        useEffect(() => () => resources.texture.dispose(), [resources]);
        return <primitive object={resources.texture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("recognizes structured resource aliases and gives up ownership when the container escapes", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useEffect, useState } from "react";
      const CleanedAlias = ({ canvas }) => {
        const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
        const texture = resources.texture;
        useEffect(() => () => texture.dispose(), [texture]);
        return <primitive object={texture} />;
      };
      const ReturnedContainer = ({ canvas }) => {
        const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
        return resources;
      };
      const AdoptedContainer = ({ canvas, manager }) => {
        const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
        manager.adopt(resources);
        return null;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("tracks structured state-factory resource paths when cleanup is missing", () => {
    const code = `
      import { CanvasTexture, DataTexture } from "three";
      import { useState } from "react";
      const Scene = ({ canvas, data }) => {
        const [resources] = useState(() => ({ texture: new CanvasTexture(canvas) }));
        const [textures] = useState(() => [new DataTexture(data)]);
        return <><primitive object={resources.texture} /><primitive object={textures[0]} /></>;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(2);
  });

  it("tracks structured array state-factory cleanup", () => {
    const code = `
      import { DataTexture } from "three";
      import { useEffect, useState } from "react";
      const Scene = ({ data }) => {
        const [textures] = useState(() => [new DataTexture(data)]);
        useEffect(() => () => textures[0].dispose(), [textures]);
        return <primitive object={textures[0]} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet when a dynamic dependency list makes cleanup scheduling unknown", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = ({ canvas, dependencies }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        useEffect(() => () => texture.dispose(), dependencies);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("resolves exact local cleanup functions and aliases", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const textureAlias = texture;
        const cleanup = () => textureAlias.dispose();
        useEffect(() => cleanup, [texture]);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet for loader-owned textures, unrelated constructors, and module ownership", () => {
    const code = `
      import { useTexture } from "@react-three/drei";
      import { CanvasTexture as OtherCanvasTexture } from "texture-library";
      import { CanvasTexture } from "three";
      const moduleTexture = new CanvasTexture(canvas);
      const Scene = () => {
        const loaderTexture = useTexture(url);
        const unrelated = new OtherCanvasTexture(canvas);
        return <meshStandardMaterial map={loaderTexture} alphaMap={unrelated} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet for shadowed constructors and JSX-owned texture elements", () => {
    const code = `
      import { CanvasTexture } from "three";
      const Scene = ({ canvas }) => {
        const CanvasTexture = class LocalTexture {};
        const local = new CanvasTexture(canvas);
        return <meshStandardMaterial><canvasTexture attach="map" args={[canvas]} /></meshStandardMaterial>;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("skips dynamically wrapped construction whose owner cannot be proven", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useMemo } from "react";
      const Scene = ({ canvas }) => {
        const wrapped = useMemo(() => configure(new CanvasTexture(canvas)), [canvas]);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet when an imported helper may own or dispose the texture", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { disposeTexture } from "./cleanup";
      import { useMemo } from "react";
      const Scene = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        disposeTexture(texture);
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("leaves texture ownership passed to custom components unknown", () => {
    const code = `
      import { ManagedTexture } from "./managed-texture";
      import { CanvasTexture } from "three";
      import { useMemo } from "react";
      const Scene = ({ canvas }) => {
        const componentTexture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const elementTexture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        return <><ManagedTexture texture={componentTexture} /><managed-texture texture={elementTexture} /></>;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("handles transparent TypeScript wrappers around construction", () => {
    const code = `
      import { CanvasTexture, Texture } from "three";
      import { useMemo } from "react";
      const Scene = ({ canvas }) => {
        const texture = useMemo(() => (new CanvasTexture(canvas) satisfies Texture), [canvas]);
        return <primitive object={texture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("follows memo-wrapped texture ownership through intrinsic and custom JSX", () => {
    const code = `
      import { CanvasTexture } from "three";
      import { useMemo } from "react";
      import { ManagedMaterial } from "./managed-material";
      const Scene = ({ firstCanvas, secondCanvas }) => {
        const managedTexture = useMemo(() => new CanvasTexture(firstCanvas), [firstCanvas]);
        const managedUniforms = useMemo(
          () => ({ map: { value: managedTexture } }),
          [managedTexture],
        );
        const intrinsicTexture = useMemo(() => new CanvasTexture(secondCanvas), [secondCanvas]);
        const intrinsicUniforms = useMemo(
          () => ({ map: { value: intrinsicTexture } }),
          [intrinsicTexture],
        );
        return <><ManagedMaterial uniforms={managedUniforms} /><shaderMaterial uniforms={intrinsicUniforms} /></>;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("reports a locally constructed texture passed through primitive JSX", () => {
    const code = `
      import { DataTexture } from "three";
      import { useMemo } from "react";
      const Scene = ({ data }) => {
        const texture = useMemo(() => new DataTexture(data), [data]);
        return <primitive object={texture} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("tracks textures nested in memoized JSX-owned uniforms", () => {
    const code = `
      import { DataTexture } from "three";
      import { useMemo } from "react";
      const Scene = ({ data }) => {
        const texture = useMemo(() => new DataTexture(data), [data]);
        const uniforms = useMemo(() => ({ texture: { value: texture } }), [texture]);
        return <shaderMaterial uniforms={uniforms} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(1);
  });

  it("allows memoized texture wrappers that escape JSX ownership", () => {
    const code = `
      import { DataTexture } from "three";
      import { useMemo } from "react";
      const Scene = ({ data, registerUniforms }) => {
        const texture = useMemo(() => new DataTexture(data), [data]);
        const uniforms = useMemo(() => ({ texture: { value: texture } }), [texture]);
        registerUniforms(uniforms);
        return <shaderMaterial uniforms={uniforms} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("keeps ownership when Three.js materials borrow textures", () => {
    const code = `
      import { CanvasTexture, MeshBasicMaterial } from "three";
      import { useMemo, useRef, useState } from "react";
      const Assigned = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const material = useMemo(() => new MeshBasicMaterial(), []);
        material.map = texture;
        return <primitive object={material} />;
      };
      const ConstructorOption = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const material = new MeshBasicMaterial({ map: texture });
        return <primitive object={material} />;
      };
      const StateMaterial = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const [material] = useState(() => new MeshBasicMaterial());
        material.map = texture;
        return <primitive object={material} />;
      };
      const RefMaterial = ({ canvas }) => {
        const texture = useMemo(() => new CanvasTexture(canvas), [canvas]);
        const materialRef = useRef(null);
        if (materialRef.current === null) materialRef.current = new MeshBasicMaterial();
        materialRef.current.map = texture;
        return <primitive object={materialRef.current} />;
      };
    `;
    expect(runRule(r3fRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(4);
  });
});
