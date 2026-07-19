import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoCloneInUseFrame } from "./r3f-no-clone-in-use-frame.js";

describe("r3f-no-clone-in-use-frame", () => {
  it("flags clones from refs and R3F state", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const mesh = useRef(null); useFrame((state) => { mesh.current.position.clone(); state.camera.position.clone(); }); return <mesh ref={mesh} />; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags clones from destructured R3F state properties", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(({ camera }) => camera.position.clone()); useFrame((state) => { const { pointer: cursor } = state; cursor.clone(); });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags clones from a defaulted R3F state parameter", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state = fallbackState) => state.camera.position.clone());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags clones through stable Three.js aliases", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const mesh = useRef(null); useFrame(({ camera }) => { const position = camera.position; position.clone(); const target = mesh.current.position; target.clone(); }); return <mesh ref={mesh} />; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags direct clones from exact JSX-managed refs and useThree selectors", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame, useThree } from "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const mesh = useRef(null); const camera = useThree((state) => state.camera); useFrame(() => { mesh.current.clone(); camera.clone(); }); return <mesh ref={mesh} />; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores clone methods without Three.js provenance", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => record.clone());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores current properties that do not come from React refs", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; const record = { current: { clone() {} } }; useFrame(() => record.current.clone());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores arbitrary values stored in React refs", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const snapshot = useRef({ clone() {}, position: { clone() {} } }); useFrame(() => { snapshot.current.clone(); snapshot.current.position.clone(); }); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a synchronous callback parameter that shadows R3F state", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state) => { records.forEach((state) => state.clone()); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a helper once when reached conditionally and unconditionally", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = ({ enabled }) => { const mesh = useRef(null); const clonePosition = () => mesh.current.position.clone(); useFrame(() => { if (enabled) clonePosition(); clonePosition(); }); return <mesh ref={mesh} />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores clones that only execute behind a frame guard", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = ({ resized }) => { const mesh = useRef(null); useFrame(() => { if (resized) mesh.current.geometry.clone(); }); return <mesh ref={mesh} />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores clone helpers that are only reached conditionally", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = ({ resized }) => { const mesh = useRef(null); const cloneGeometry = () => mesh.current.geometry.clone(); useFrame(() => { resized && cloneGeometry(); }); return <mesh ref={mesh} />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
