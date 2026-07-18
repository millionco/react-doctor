import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoUnstableArgs } from "./r3f-no-unstable-args.js";

describe("r3f-no-unstable-args", () => {
  it("flags inline and render-local reference-valued constructor args", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber";
       import { Vector3 } from "three";
       const Scene = () => { const args = [{ width: 1 }]; return <><shapeGeometry args={[new Vector3()]} /><mesh args={args} /></>; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows fresh args arrays whose elements compare equal", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber";
       const Scene = () => { const args = [1, 2, 3]; return <><boxGeometry args={[1, 2, 3]} /><mesh args={args} /></>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows stable reference-valued args", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; import { Vector3 } from "three";
       const origin = new Vector3(); const args = [origin]; const Scene = () => <shapeGeometry args={args} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows constructor args created once in a stable JSX context", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; import { useMemo, useState } from "react"; const moduleNode = <mesh args={[{ width: 1 }]} />; const Scene = () => { const memoized = useMemo(() => <mesh args={[{ width: 1 }]} />, []); const [lazy] = useState(() => <mesh args={[{ width: 1 }]} />); return <>{memoized}{lazy}</>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows DOM and custom elements in mixed R3F files", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; const Scene = () => <><input args={[{ role: "search" }]} /><my-widget args={[{ theme: "dark" }]} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes public R3F entry points", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber/native"; const Scene = () => <mesh args={[{ width: 1 }]} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes the R3F line intrinsic despite its SVG name collision", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; const Scene = () => <line args={[{ width: 1 }]} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a type-only import as renderer evidence", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import type { RootState } from "@react-three/fiber"; const View = () => <model args={[]} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows render-local conditional aliases", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; const Scene = ({ wide, stable }) => { const args = wide ? [{ width: 2 }] : stable; return <boxGeometry args={args} />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows spread arrays without flagging stable scalar elements", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; const Scene = () => { const unstable = [{ width: 2 }]; const stable = [1, 2]; return <><boxGeometry args={[...unstable]} /><boxGeometry args={[...stable]} /></>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects JSX spread override order", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `import { Canvas } from "@react-three/fiber"; const Scene = ({ props }) => <><mesh args={[{ width: 1 }]} {...props} /><mesh {...props} args={[{ width: 1 }]} /><mesh args={[{ width: 1 }]} {...{ visible: true }} /><mesh args={[{ width: 1 }]} {...{ args: stableArgs }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows JSX stabilized by CommonJS React useMemo", () => {
    const result = runRule(
      r3fNoUnstableArgs,
      `const Fiber = require("@react-three/fiber"); const React = require("react"); const THREE = require("three"); const Scene = () => React.useMemo(() => <shapeGeometry args={[new THREE.Vector3()]} />, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
