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

  it("ignores constructors from mutated CommonJS Three.js namespaces", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const THREE = require("three");
      THREE.BufferGeometry = ReplacementGeometry;
      function Scene() {
        return <mesh geometry={new THREE.BufferGeometry()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves qualified TypeScript import-equals Three.js aliases", () => {
    const code = `
      import "@react-three/fiber";
      import THREE = require("three");
      import Geometry = THREE.BufferGeometry;
      const geometry = new Geometry();
      function Scene() {
        return <mesh geometry={geometry.clone()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(1);
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
      import { BufferGeometry, MeshBasicMaterial } from "three";
      function Scene({ stableMaterial }) {
        const geometry = new BufferGeometry();
        const material = new MeshBasicMaterial();
        return <><mesh geometry={geometry.clone()} material={material.clone()} /><mesh material={[stableMaterial, material.clone()]} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports render-time conversion of a stable indexed geometry", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BufferGeometry } from "three";
      const geometry = new BufferGeometry().setIndex([0, 1, 2]);
      function Scene() {
        return <mesh geometry={geometry.toNonIndexed()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows conversion calls when a stable geometry is not proven indexed", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BufferGeometry } from "three";
      const geometry = new BufferGeometry();
      const maybeIndexedGeometry = new BufferGeometry().setIndex(loadIndex());
      function Scene() {
        return <><mesh geometry={geometry.toNonIndexed()} /><mesh geometry={maybeIndexedGeometry.toNonIndexed()} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores resource methods without Three.js resource provenance", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      function Scene({ cloneableGeometryConfig, cloneableMaterialConfig, geometryConfig }) {
        return <><mesh geometry={cloneableGeometryConfig.clone()} material={cloneableMaterialConfig.clone()} /><mesh geometry={geometryConfig.toNonIndexed()} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows resources owned by proven Three.js objects", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BufferGeometry, Mesh } from "three";
      function Scene() {
        const mesh = new Mesh(new BufferGeometry());
        return <mesh geometry={mesh.geometry.clone()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat arbitrary Three.js method results as geometry or material", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BufferGeometry, MeshBasicMaterial } from "three";
      function Scene() {
        const geometry = new BufferGeometry();
        const material = new MeshBasicMaterial();
        return <mesh geometry={geometry.getAttribute("position").clone()} material={material.toJSON().clone()} />;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat void BufferGeometry method results as geometries", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { BufferGeometry } from "three";
      function Scene() {
        return <><mesh geometry={new BufferGeometry().computeBoundingBox()} /><mesh geometry={new BufferGeometry().addGroup(0, 3)} /></>;
      }
    `;
    const result = runRule(r3fNoInlineResourceProp, code);
    expect(result.diagnostics).toHaveLength(0);
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

  it("allows JSX stabilized by CommonJS React useMemo", () => {
    const result = runRule(
      r3fNoInlineResourceProp,
      `const Fiber = require("@react-three/fiber"); const React = require("react"); const THREE = require("three"); const Scene = () => React.useMemo(() => <mesh material={new THREE.MeshBasicMaterial()} />, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
