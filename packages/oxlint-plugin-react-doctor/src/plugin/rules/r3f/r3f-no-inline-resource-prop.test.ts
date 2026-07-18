import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoInlineResourceProp } from "./r3f-no-inline-resource-prop.js";

describe("r3f-no-inline-resource-prop", () => {
  it("reports named, renamed, namespace, and local resource constructions", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BoxGeometry as Geometry, MeshBasicMaterial } from "three";
      import * as THREE from "three";
      function Scene() {
        const material = new MeshBasicMaterial();
        return <><mesh geometry={new Geometry()} /><mesh material={new THREE.MeshStandardMaterial()} /><mesh material={material} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports CommonJS Three.js resource constructions", () => {
    const code = `
      const Fiber = require("@react-three/fiber");
      const { BoxGeometry: Geometry } = require("three");
      const THREE = require("three");
      const Material = require("three").MeshBasicMaterial;
      function Scene() {
        return <><mesh geometry={new Geometry()} /><mesh material={new THREE.MeshStandardMaterial()} /><mesh material={new Material()} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("ignores Three.js constructors loaded through a shadowed require", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      function Scene(require) {
        const { MeshBasicMaterial } = require("three");
        return <mesh material={new MeshBasicMaterial()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports chained geometry construction and fresh entries in material arrays", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BufferGeometry, MeshBasicMaterial } from "three";
      function Scene({ points, stableMaterial }) {
        return <mesh geometry={new BufferGeometry().setFromPoints(points)} material={[stableMaterial, new MeshBasicMaterial()]} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports render-time resource clones", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      function Scene({ geometry, material, stableMaterial }) {
        return <><mesh geometry={geometry.clone()} material={material.clone()} /><mesh material={[stableMaterial, material.clone()]} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows module, memoized, lazy-state, and loader-owned resources", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { useMemo, useState } from "react";
      import { BoxGeometry, MeshBasicMaterial } from "three";
      const moduleGeometry = new BoxGeometry();
      const moduleMaterial = new MeshBasicMaterial();
      function Scene({ nodes, materials }) {
        const geometry = useMemo(() => new BoxGeometry(), []);
        const [material] = useState(() => new MeshBasicMaterial());
        return <><mesh geometry={moduleGeometry} material={moduleMaterial} /><mesh geometry={geometry} material={material} /><mesh geometry={nodes.Body.geometry} material={materials.Body} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows JSX stabilized by useMemo and module initialization", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { MeshBasicMaterial } from "three";
      import { useMemo } from "react";
      const moduleNode = <mesh material={new MeshBasicMaterial()} />;
      function Scene() {
        return useMemo(() => <mesh material={new MeshBasicMaterial()} />, []);
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated constructors, hosts, and overridden props", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { Material } from "material-library";
      import { MeshBasicMaterial } from "three";
      function Scene({ props }) {
        return <><mesh material={new Material()} /><customMesh material={new MeshBasicMaterial()} /><mesh material={new MeshBasicMaterial()} {...props} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires local R3F evidence", () => {
    const code = `
      import { MeshBasicMaterial } from "three";
      function Scene() {
        return <mesh material={new MeshBasicMaterial()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores type-only R3F imports", () => {
    const code = `
      import type { RootState } from "@react-three/fiber";
      import { type ThreeElements } from "@react-three/fiber/native";
      import { MeshBasicMaterial } from "three";
      function Scene() {
        return <mesh material={new MeshBasicMaterial()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
