import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoNewInUseFrame } from "./r3f-no-new-in-use-frame.js";

describe("r3f-no-new-in-use-frame", () => {
  it("flags allocations through aliased useFrame imports", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import { useFrame as frame } from "@react-three/fiber"; frame(() => { const vector = new Vector3(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows synchronously called callbacks", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => { events.map(() => new Event()); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores uncalled nested functions and homegrown hooks", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const useFrame = (callback) => callback(); useFrame(() => { const later = () => new Event(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a shadowed imported hook", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import { useFrame } from "@react-three/fiber"; const Scene = () => { const useFrame = runOnce; useFrame(() => new Vector3()); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
