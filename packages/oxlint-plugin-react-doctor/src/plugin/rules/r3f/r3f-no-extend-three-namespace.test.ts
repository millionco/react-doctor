import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoExtendThreeNamespace } from "./r3f-no-extend-three-namespace.js";

describe("r3f-no-extend-three-namespace", () => {
  it("reports the core Three.js namespace without flagging the official WebGPU setup", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import { extend } from "@react-three/fiber";
        import * as THREE from "three";
        import * as WebGPU from "three/webgpu";
        extend(THREE);
        extend(WebGPU);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports the core namespace spread without flagging WebGPU catalogue aliases", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import { extend } from "@react-three/fiber";
        import * as THREE from "three";
        import * as WebGPU from "three/webgpu";
        extend({ ...THREE });
        const catalogue = { Mesh: CustomMesh, ...WebGPU };
        extend(catalogue);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows the R3F v9 WebGPU namespace catalogue through transparent wrappers", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import { extend } from "@react-three/fiber";
        import * as THREE from "three/webgpu";
        const WebGPU = THREE;
        extend(THREE as any);
        extend({ ...WebGPU });
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves R3F and Three.js namespace aliases across module systems", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import * as Fiber from "@react-three/fiber/native";
        import Three = require("three");
        const catalogue = Three;
        Fiber.extend(catalogue);
        const CommonJsFiber = require("@react-three/fiber");
        CommonJsFiber.extend(require("three"));
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows granular constructor catalogues", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import { extend } from "@react-three/fiber";
        import { Mesh, OrbitControls } from "three";
        import * as THREE from "three";
        const granular = { Mesh, OrbitControls };
        extend({ Mesh, OrbitControls });
        extend({ Mesh: THREE.Mesh });
        extend({ ...granular });
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores namespace registration in test files", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import { extend } from "@react-three/fiber";
        import * as THREE from "three";
        extend(THREE);
      `,
      { filename: "src/EffectComposer.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated, shadowed, default, mutable, and subpath values", () => {
    const result = runRule(
      r3fNoExtendThreeNamespace,
      `
        import { extend } from "other-renderer";
        import { extend as r3fExtend } from "@react-three/fiber";
        import * as THREE from "three";
        import * as Addons from "three/addons/loaders/GLTFLoader.js";
        import ThreeDefault from "three";
        let catalogue = THREE;
        catalogue = customCatalogue;
        extend(THREE);
        r3fExtend(catalogue);
        r3fExtend(Addons);
        r3fExtend(ThreeDefault);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
