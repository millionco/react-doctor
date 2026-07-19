import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoImperativeAttachOfManagedRef } from "./r3f-no-imperative-attach-of-managed-ref.js";

describe("r3f-no-imperative-attach-of-managed-ref", () => {
  it("reports React refs managed by JSX and imperatively added or attached", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import { Canvas } from "@react-three/fiber";
        import { Group, Scene as ThreeScene } from "three";
        const Scene = () => {
          const groupRef = useRef(null);
          const refAlias = groupRef;
          const scene = new ThreeScene();
          const parent = new Group();
          scene.add(groupRef.current);
          parent["attach"]((refAlias.current));
          return <group ref={refAlias} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports React namespace refs, primitive refs, and attachment before the JSX", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import * as React from "react";
        import * as Fiber from "@react-three/fiber";
        import * as THREE from "three";
        const Scene = ({ object }) => {
          const objectRef = React.createRef();
          const scene = new THREE.Scene();
          scene.add(objectRef.current);
          return <primitive ref={objectRef} object={object} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows cleanup removal and objects not managed through JSX", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import "@react-three/fiber";
        import { Scene as ThreeScene } from "three";
        const Scene = () => {
          const managedRef = useRef(null);
          const imperativeRef = useRef(null);
          const scene = new ThreeScene();
          scene.remove(managedRef.current);
          scene.add(imperativeRef.current);
          return <group ref={managedRef} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores custom components, web components, DOM elements, and overridden ref props", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import { Canvas } from "@react-three/fiber";
        import { Scene as ThreeScene } from "three";
        const Scene = ({ props }) => {
          const customRef = useRef(null);
          const webComponentRef = useRef(null);
          const domRef = useRef(null);
          const overriddenRef = useRef(null);
          const scene = new ThreeScene();
          scene.add(customRef.current);
          scene.add(webComponentRef.current);
          scene.add(domRef.current);
          scene.add(overriddenRef.current);
          return <><CustomObject ref={customRef} /><model-preview ref={webComponentRef} /><div ref={domRef} /><group ref={overriddenRef} {...props} /></>;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores SVG line refs in mixed R3F and DOM files", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import { Canvas } from "@react-three/fiber";
        import { Scene } from "three";
        const Icon = () => {
          const lineRef = useRef(null);
          const scene = new Scene();
          scene.add(lineRef.current);
          return <svg><g><line ref={lineRef} /></g></svg>;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores add and attach methods on unknown non-Three receivers", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import "@react-three/fiber";
        const Scene = ({ registry, relationship }) => {
          const meshRef = useRef(null);
          new Set().add(meshRef.current);
          registry.add(meshRef.current);
          relationship.attach(meshRef.current);
          return <mesh ref={meshRef} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports scene ownership obtained from useThree and useFrame state", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import { useFrame, useThree } from "@react-three/fiber";
        const SelectedScene = () => {
          const meshRef = useRef(null);
          const world = useThree((state) => state.scene);
          world.add(meshRef.current);
          return <mesh ref={meshRef} />;
        };
        const FrameScene = () => {
          const groupRef = useRef(null);
          useFrame(({ scene }) => scene.attach(groupRef.current));
          return <group ref={groupRef} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports a managed R3F parent ref imperatively adopting another managed ref", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import "@react-three/fiber";
        const Scene = () => {
          const parentRef = useRef(null);
          const childRef = useRef(null);
          parentRef.current.add(childRef.current);
          return <group ref={parentRef}><mesh ref={childRef} /></group>;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a ref-shaped but unmanaged parent receiver quiet", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import "@react-three/fiber";
        const Scene = () => {
          const parentRef = useRef(null);
          const childRef = useRef(null);
          parentRef.current.add(childRef.current);
          return <mesh ref={childRef} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores non-React ref-shaped values and shadowed React APIs", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        import "@react-three/fiber";
        import { Scene as ThreeScene } from "three";
        const record = { current: null };
        scene.add(record.current);
        const Scene = ({ useRef }) => {
          const localRef = useRef(null);
          const scene = new ThreeScene();
          scene.add(localRef.current);
          return <group ref={localRef} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires an R3F runtime import", () => {
    const result = runRule(
      r3fNoImperativeAttachOfManagedRef,
      `
        import { useRef } from "react";
        const Scene = ({ scene }) => {
          const groupRef = useRef(null);
          scene.add(groupRef.current);
          return <group ref={groupRef} />;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
