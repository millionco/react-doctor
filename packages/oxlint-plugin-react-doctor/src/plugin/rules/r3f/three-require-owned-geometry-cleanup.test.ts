import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireOwnedGeometryCleanup } from "./three-require-owned-geometry-cleanup.js";

describe("three-require-owned-geometry-cleanup", () => {
  it("reports named, aliased, namespace, and effect-owned geometries without cleanup", () => {
    const code = `
      import * as THREE from "three";
      import { BoxGeometry as Geometry } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = () => {
        const first = useMemo(() => new Geometry(), []);
        const second = new THREE.BufferGeometry();
        useEffect(() => {
          const third = new THREE.SphereGeometry();
          third.computeBoundingSphere();
        }, []);
        return first.name + second.name;
      };
    `;
    expect(runRule(threeRequireOwnedGeometryCleanup, code).diagnostics).toHaveLength(3);
  });

  it("accepts React cleanup and unconditional immediate disposal", () => {
    const code = `
      import { BoxGeometry, BufferGeometry } from "three";
      import { useEffect, useMemo } from "react";
      const Scene = () => {
        const geometry = useMemo(() => new BoxGeometry(), []);
        useEffect(() => () => geometry.dispose(), [geometry]);
        useEffect(() => {
          const temporary = new BufferGeometry();
          temporary.dispose();
        }, []);
        return null;
      };
    `;
    expect(runRule(threeRequireOwnedGeometryCleanup, code).diagnostics).toHaveLength(0);
  });

  it("keeps ownership when a Three.js mesh borrows the geometry", () => {
    const code = `
      import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
      import { useMemo } from "react";
      const Scene = () => {
        const geometry = useMemo(() => new BoxGeometry(), []);
        const mesh = new Mesh(geometry, new MeshBasicMaterial());
        return mesh.name;
      };
    `;
    expect(runRule(threeRequireOwnedGeometryCleanup, code).diagnostics).toHaveLength(1);
  });

  it("stays quiet when ownership escapes, is module-scoped, or belongs to JSX", () => {
    const code = `
      import { BoxGeometry } from "three";
      import { useMemo } from "react";
      const moduleGeometry = new BoxGeometry();
      const Scene = ({ manager }) => {
        const adopted = useMemo(() => new BoxGeometry(), []);
        const declarative = useMemo(() => new BoxGeometry(), []);
        manager.adopt(adopted);
        return <mesh geometry={declarative} />;
      };
    `;
    expect(runRule(threeRequireOwnedGeometryCleanup, code).diagnostics).toHaveLength(0);
  });

  it("ignores unrelated and shadowed geometry constructors", () => {
    const code = `
      import { BoxGeometry as OtherGeometry } from "geometry-library";
      import * as THREE from "three";
      const Scene = () => {
        const THREE = { BoxGeometry: OtherGeometry };
        const first = new OtherGeometry();
        const second = new THREE.BoxGeometry();
        return first.name + second.name;
      };
    `;
    expect(runRule(threeRequireOwnedGeometryCleanup, code).diagnostics).toHaveLength(0);
  });
});
