import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireOwnedTextureCleanup } from "./three-require-owned-texture-cleanup.js";

describe("three-require-owned-texture-cleanup", () => {
  it("reports direct Three.js textures owned by React", () => {
    const code = `
      import * as THREE from "three";
      import { CanvasTexture as Texture, DepthTexture } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = ({ canvas, video }) => {
        const first = useMemo(() => new Texture(canvas), [canvas]);
        const depth = useMemo(() => new DepthTexture(), []);
        useEffect(() => {
          const second = new THREE.VideoTexture(video);
          second.needsUpdate = true;
        }, [video]);
        return first.image ?? depth.image;
      };
    `;
    expect(runRule(threeRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(3);
  });

  it("accepts React cleanup and unconditional immediate disposal", () => {
    const code = `
      import { DataTexture, Texture } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = ({ data }) => {
        const texture = useMemo(() => new DataTexture(data), [data]);
        useEffect(() => () => texture.dispose(), [texture]);
        useEffect(() => {
          const temporary = new Texture();
          temporary.dispose();
        }, []);
        return null;
      };
    `;
    expect(runRule(threeRequireOwnedTextureCleanup, code).diagnostics).toHaveLength(0);
  });

  it("defers to the legacy R3F rule in R3F projects", () => {
    expect(threeRequireOwnedTextureCleanup.disabledWhen).toEqual(["r3f"]);
  });
});
