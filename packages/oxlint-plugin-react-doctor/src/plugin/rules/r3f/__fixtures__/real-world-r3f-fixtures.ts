import type { Rule } from "../../../utils/rule.js";
import { r3fNoAdvancingClockInUseFrame } from "../r3f-no-advancing-clock-in-use-frame.js";
import { r3fNoAsyncUseFrame } from "../r3f-no-async-use-frame.js";
import { r3fNoCloneInUseFrame } from "../r3f-no-clone-in-use-frame.js";
import { r3fNoDuplicatePrimitiveObject } from "../r3f-no-duplicate-primitive-object.js";
import { r3fNoFreshUseThreeSelector } from "../r3f-no-fresh-use-three-selector.js";
import { r3fNoInlinePrimitiveObject } from "../r3f-no-inline-primitive-object.js";
import { r3fNoInternalImports } from "../r3f-no-internal-imports.js";
import { r3fNoNewInUseFrame } from "../r3f-no-new-in-use-frame.js";
import { r3fNoStateInUseFrame } from "../r3f-no-state-in-use-frame.js";
import { r3fNoUnstableArgs } from "../r3f-no-unstable-args.js";
import { r3fRequireFrameDelta } from "../r3f-require-frame-delta.js";

export interface R3fRealWorldFixture {
  readonly code: string;
  readonly expectedDiagnosticCount: number;
  readonly name: string;
  readonly rule: Rule;
  readonly sourceUrl: string;
}

export const r3fRealWorldFixtures: R3fRealWorldFixture[] = [
  {
    name: "allows the official basic-demo scalar args array",
    sourceUrl:
      "https://github.com/pmndrs/examples/blob/a2700f7983cadaa1d90a6d4ddda0acab2f0a29fe/demos/basic-demo/src/App.jsx#L22",
    rule: r3fNoUnstableArgs,
    expectedDiagnosticCount: 0,
    code: `import { Canvas } from "@react-three/fiber";
      const Box = () => <boxGeometry args={[1, 1, 1]} />;`,
  },
  {
    name: "allows Drei RoundedBox memoized reference args",
    sourceUrl:
      "https://github.com/pmndrs/drei/blob/c9d3d0dc9473f026c83965a7eb8c7f7a1a1bf0ae/src/core/RoundedBox.tsx#L78-L99",
    rule: r3fNoUnstableArgs,
    expectedDiagnosticCount: 0,
    code: `import * as React from "react";
      import { Canvas } from "@react-three/fiber";
      import { Shape } from "three";
      const RoundedBox = () => {
        const shape = React.useMemo(() => new Shape(), []);
        const params = React.useMemo(() => ({ depth: 1 }), []);
        return <extrudeGeometry args={[shape, params]} />;
      };`,
  },
  {
    name: "reports fresh typed arrays in the official grass demo",
    sourceUrl:
      "https://github.com/pmndrs/examples/blob/a2700f7983cadaa1d90a6d4ddda0acab2f0a29fe/demos/grass-shader/src/Grass.jsx#L44",
    rule: r3fNoUnstableArgs,
    expectedDiagnosticCount: 1,
    code: `import { Canvas } from "@react-three/fiber";
      const Grass = ({ offsets }) => <instancedBufferAttribute args={[new Float32Array(offsets), 3]} />;`,
  },
  {
    name: "reports a render-time GLTF clone from react-three-rapier",
    sourceUrl:
      "https://github.com/pmndrs/react-three-rapier/blob/ae5c3fede5ca489fd7eaa8271e9d9c5eabc88e98/demo/src/examples/collision-events/CollisionEventsExample.tsx#L25-L30",
    rule: r3fNoInlinePrimitiveObject,
    expectedDiagnosticCount: 1,
    code: `import { Canvas } from "@react-three/fiber";
      const Suzanne = ({ nodes }) => <primitive object={nodes.Suzanne.clone()} />;`,
  },
  {
    name: "allows a stable postprocessing effect primitive",
    sourceUrl:
      "https://github.com/pmndrs/react-postprocessing/blob/90d10d59fe5a1a86e027c1bedd36dcf3b87ddd1c/src/effects/Pixelation.tsx#L8-L14",
    rule: r3fNoInlinePrimitiveObject,
    expectedDiagnosticCount: 0,
    code: `import { useMemo } from "react";
      import { Canvas } from "@react-three/fiber";
      const Pixelation = () => {
        const effect = useMemo(() => createEffect(), []);
        return <primitive object={effect} />;
      };`,
  },
  {
    name: "reports the playroom target-list update from useFrame",
    sourceUrl:
      "https://github.com/asadm/playroom-docs/blob/10e4f1883262a4656f8075c6fe6a418ddce0683c/examples/r3f-plane-rings/src/Targets.jsx#L57-L75",
    rule: r3fNoStateInUseFrame,
    expectedDiagnosticCount: 1,
    code: `import { useState } from "react";
      import { useFrame } from "@react-three/fiber";
      const Targets = () => {
        const [targets, setTargets] = useState([]);
        useFrame(() => { if (targets.find((target) => target.hit)) setTargets(targets.filter((target) => !target.hit)); });
        return null;
      };`,
  },
  {
    name: "allows react-three-flex's comparison-guarded size transition",
    sourceUrl:
      "https://github.com/pmndrs/react-three-flex/blob/13e4b2d06f133eef41007a9af6955b5f989f48f2/src/Box.tsx#L221-L230",
    rule: r3fNoStateInUseFrame,
    expectedDiagnosticCount: 0,
    code: `import { useState } from "react";
      import { useFrame } from "@react-three/fiber";
      const Box = ({ width }) => {
        const [size, setSize] = useState([0, 0]);
        useFrame(() => { if (width !== size[0]) setSize([width, size[1]]); });
        return null;
      };`,
  },
  {
    name: "allows Gitlantis's previous-tile comparison guard",
    sourceUrl:
      "https://github.com/liltrendi/gitlantis/blob/e52016fa73acc568b53da8435e1ba5d9a509ac09/src/browser/hooks/useOcean/regen/index.ts#L73-L84",
    rule: r3fNoStateInUseFrame,
    expectedDiagnosticCount: 0,
    code: `import { useState } from "react";
      import { useFrame } from "@react-three/fiber";
      const Ocean = () => {
        const [tiles, setTiles] = useState([]);
        useFrame(() => { const currentKeys = readCurrentKeys(); const newKeys = readNewKeys(); if (currentKeys !== newKeys) setTiles(generateTiles()); });
        return tiles;
      };`,
  },
  {
    name: "allows three-geospatial's catch-only error transition",
    sourceUrl:
      "https://github.com/takram-design-engineering/three-geospatial/blob/b012ad06d858fc035d88aacfd73f092f93c994e4/storybook-webgpu/src/hooks/useGuardedFrame.ts#L11-L19",
    rule: r3fNoStateInUseFrame,
    expectedDiagnosticCount: 0,
    code: `import { useState } from "react";
      import { useFrame } from "@react-three/fiber";
      const Guarded = ({ callback }) => {
        const [error, setError] = useState(null);
        useFrame((state, delta) => { try { callback(state, delta); } catch (caughtError) { setError(caughtError); } });
        return error;
      };`,
  },
  {
    name: "reports the official Minecraft demo's per-frame Rapier ray",
    sourceUrl:
      "https://github.com/pmndrs/examples/blob/a2700f7983cadaa1d90a6d4ddda0acab2f0a29fe/demos/minecraft/src/Player.jsx#L21-L38",
    rule: r3fNoNewInUseFrame,
    expectedDiagnosticCount: 1,
    code: `import * as RAPIER from "@dimforge/rapier3d-compat";
      import { useFrame } from "@react-three/fiber";
      const Player = ({ world, body }) => {
        useFrame(() => world.castRay(new RAPIER.Ray(body.translation(), { x: 0, y: -1, z: 0 })));
        return null;
      };`,
  },
  {
    name: "reports Drei Billboard's per-frame Euler clone",
    sourceUrl:
      "https://github.com/pmndrs/drei/blob/c9d3d0dc9473f026c83965a7eb8c7f7a1a1bf0ae/src/core/Billboard.tsx#L30-L34",
    rule: r3fNoCloneInUseFrame,
    expectedDiagnosticCount: 1,
    code: `import { useRef } from "react";
      import { useFrame } from "@react-three/fiber";
      const Billboard = () => {
        const inner = useRef();
        useFrame(() => { const previousRotation = inner.current.rotation.clone(); consume(previousRotation); });
        return <group ref={inner} />;
      };`,
  },
  {
    name: "reports the fixed-step rotation in the official flexbox demo",
    sourceUrl:
      "https://github.com/pmndrs/examples/blob/a2700f7983cadaa1d90a6d4ddda0acab2f0a29fe/demos/flexbox-yoga-in-webgl/src/components/Geo.jsx#L13-L20",
    rule: r3fRequireFrameDelta,
    expectedDiagnosticCount: 1,
    code: `import { useRef } from "react";
      import { useFrame } from "@react-three/fiber";
      const Geo = () => {
        const group = useRef();
        useFrame(() => { group.current.rotation.z += 0.005; });
        return <group ref={group} />;
      };`,
  },
  {
    name: "reports the mutating clock read in the official flexbox demo",
    sourceUrl:
      "https://github.com/pmndrs/examples/blob/a2700f7983cadaa1d90a6d4ddda0acab2f0a29fe/demos/flexbox-yoga-in-webgl/src/components/Geo.jsx#L13-L16",
    rule: r3fNoAdvancingClockInUseFrame,
    expectedDiagnosticCount: 1,
    code: `import { useFrame } from "@react-three/fiber";
      const Geo = () => { useFrame(({ clock }) => consume(clock.getElapsedTime())); return null; };`,
  },
  {
    name: "reports react-postprocessing's async Autofocus frame callback",
    sourceUrl:
      "https://github.com/pmndrs/react-postprocessing/blob/90d10d59fe5a1a86e027c1bedd36dcf3b87ddd1c/src/effects/Autofocus.tsx#L108-L118",
    rule: r3fNoAsyncUseFrame,
    expectedDiagnosticCount: 1,
    code: `import { useFrame } from "@react-three/fiber";
      const Autofocus = ({ update }) => { useFrame(async (_, delta) => { update(delta); }); return null; };`,
  },
  {
    name: "reports the array selector pattern in 3DTilesRendererJS",
    sourceUrl:
      "https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/688df2a34db08b9b78a5686ece4a9581a01932b8/src/r3f/components/CameraControls.jsx#L14-L19",
    rule: r3fNoFreshUseThreeSelector,
    expectedDiagnosticCount: 1,
    code: `import { useThree } from "@react-three/fiber";
      const Controls = () => { const [camera] = useThree((state) => [state.camera]); return camera; };`,
  },
  {
    name: "allows distinct primitive objects in the official renderer array test",
    sourceUrl:
      "https://github.com/pmndrs/react-three-fiber/blob/7dfaeaaab270ebef2b176e8bcaa5819702c34794/packages/fiber/tests/renderer.test.tsx#L488-L497",
    rule: r3fNoDuplicatePrimitiveObject,
    expectedDiagnosticCount: 0,
    code: `import { Canvas } from "@react-three/fiber";
      const Objects = ({ objects }) => <>{objects.map((object) => <primitive key={object.uuid} object={object} />)}</>;`,
  },
  {
    name: "reports Drei's private event declaration import",
    sourceUrl:
      "https://github.com/pmndrs/drei/blob/c9d3d0dc9473f026c83965a7eb8c7f7a1a1bf0ae/src/web/ScrollControls.tsx#L5",
    rule: r3fNoInternalImports,
    expectedDiagnosticCount: 1,
    code: `import { DomEvent } from "@react-three/fiber/dist/declarations/src/core/events"; consume(DomEvent);`,
  },
];
