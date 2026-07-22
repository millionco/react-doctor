import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireOwnedMaterialCleanup } from "./three-require-owned-material-cleanup.js";

describe("three-require-owned-material-cleanup", () => {
  it("reports named, aliased, namespace, and effect-owned materials without cleanup", () => {
    const code = `
      import * as THREE from "three";
      import { MeshBasicMaterial as BasicMaterial } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = () => {
        const first = useMemo(() => new BasicMaterial(), []);
        const second = new THREE.ShaderMaterial();
        useEffect(() => {
          const third = new THREE.MeshStandardMaterial();
          third.needsUpdate = true;
        }, []);
        return first.name + second.name;
      };
    `;
    expect(runRule(threeRequireOwnedMaterialCleanup, code).diagnostics).toHaveLength(3);
  });

  it("accepts React cleanup and unconditional immediate disposal", () => {
    const code = `
      import { MeshBasicMaterial, ShaderMaterial } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = () => {
        const material = useMemo(() => new MeshBasicMaterial(), []);
        useEffect(() => () => material.dispose(), [material]);
        useEffect(() => {
          const temporary = new ShaderMaterial();
          temporary.dispose();
        }, []);
        return null;
      };
    `;
    expect(runRule(threeRequireOwnedMaterialCleanup, code).diagnostics).toHaveLength(0);
  });

  it("keeps ownership when a Three.js mesh borrows the material", () => {
    const code = `
      import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
      import { useMemo } from "react";
      const Scene = () => {
        const material = useMemo(() => new MeshBasicMaterial(), []);
        const mesh = new Mesh(new BoxGeometry(), material);
        return mesh.name;
      };
    `;
    expect(runRule(threeRequireOwnedMaterialCleanup, code).diagnostics).toHaveLength(1);
  });

  it("stays quiet when ownership escapes, is module-scoped, or belongs to JSX", () => {
    const code = `
      import { MeshBasicMaterial } from "three";
      import { useMemo } from "react";
      const moduleMaterial = new MeshBasicMaterial();
      const Scene = ({ manager }) => {
        const adopted = useMemo(() => new MeshBasicMaterial(), []);
        const declarative = useMemo(() => new MeshBasicMaterial(), []);
        manager.adopt(adopted);
        return <mesh material={declarative} />;
      };
    `;
    expect(runRule(threeRequireOwnedMaterialCleanup, code).diagnostics).toHaveLength(0);
  });

  it("ignores unrelated and shadowed material constructors", () => {
    const code = `
      import { MeshBasicMaterial as OtherMaterial } from "material-library";
      import * as THREE from "three";
      const Scene = () => {
        const THREE = { MeshBasicMaterial: OtherMaterial };
        const first = new OtherMaterial();
        const second = new THREE.MeshBasicMaterial();
        return first.name + second.name;
      };
    `;
    expect(runRule(threeRequireOwnedMaterialCleanup, code).diagnostics).toHaveLength(0);
  });
});
