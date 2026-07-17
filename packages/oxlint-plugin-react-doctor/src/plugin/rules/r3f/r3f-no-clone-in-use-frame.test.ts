import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoCloneInUseFrame } from "./r3f-no-clone-in-use-frame.js";

describe("r3f-no-clone-in-use-frame", () => {
  it("flags clones from refs and R3F state", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state) => { mesh.current.position.clone(); state.camera.position.clone(); });`,
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
      `import { useFrame } from "@react-three/fiber"; useFrame(({ camera }) => { const position = camera.position; position.clone(); const target = mesh.current.position; target.clone(); });`,
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

  it("ignores a synchronous callback parameter that shadows R3F state", () => {
    const result = runRule(
      r3fNoCloneInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame((state) => { records.forEach((state) => state.clone()); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
