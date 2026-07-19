import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoDeepUseThreeSelector } from "./r3f-no-deep-use-three-selector.js";

describe("r3f-no-deep-use-three-selector", () => {
  it("requires a useThree-capable R3F release", () => {
    expect(r3fNoDeepUseThreeSelector.requires).toEqual(["r3f:6"]);
  });

  it("reports deep mutable fields through direct and destructured selectors", () => {
    const result = runRule(
      r3fNoDeepUseThreeSelector,
      `import { useThree } from "@react-three/fiber";
       const zoom = useThree((state) => state.camera.zoom);
       const position = useThree(({ camera }) => camera.position.x);
       const elapsed = useThree((state) => { const clock = state.clock; return clock.elapsedTime; });`,
    );
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "This selector reads the mutable zoom field from camera, but deep Three.js mutations do not update the R3F store. Select camera itself and read zoom at the point of use",
      "This selector reads the mutable x field from camera, but deep Three.js mutations do not update the R3F store. Select camera itself and read x at the point of use",
      "This selector reads the mutable elapsedTime field from clock, but deep Three.js mutations do not update the R3F store. Select clock itself and read elapsedTime at the point of use",
    ]);
  });

  it("resolves aliases, namespace APIs, and useCallback selectors", () => {
    const result = runRule(
      r3fNoDeepUseThreeSelector,
      `import * as Fiber from "@react-three/fiber";
       import { useCallback } from "react";
       const selector = useCallback((state) => { const camera = state.camera; return camera["fov"]; }, []);
       const fov = Fiber.useThree(selector);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows stable store fields and replaceable structural state", () => {
    const result = runRule(
      r3fNoDeepUseThreeSelector,
      `import { useThree } from "@react-three/fiber";
       const camera = useThree((state) => state.camera);
       const cameraPosition = useThree((state) => state.camera.position);
       const canvas = useThree((state) => state.gl.domElement);
       const width = useThree((state) => state.size.width);
       const viewportWidth = useThree((state) => state.viewport.width);
       const invalidate = useThree((state) => state.invalidate);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores imported, dynamic, shadowed, and unrelated selectors", () => {
    const result = runRule(
      r3fNoDeepUseThreeSelector,
      `import { useThree as importedUseThree } from "other-store";
       import { selector } from "./selector";
       import { useThree } from "@react-three/fiber";
       const imported = useThree(selector);
       const dynamic = useThree((state) => state.camera[property]);
       const unrelated = importedUseThree((state) => state.camera.zoom);
       const local = (() => { const useThree = importedUseThree; return useThree((state) => state.camera.zoom); })();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
