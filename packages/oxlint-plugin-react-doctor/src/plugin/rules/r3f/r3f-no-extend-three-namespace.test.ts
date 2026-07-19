import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoExtendThreeNamespace } from "./r3f-no-extend-three-namespace.js";

describe("r3f-no-extend-three-namespace", () => {
  it("requires an R3F version that exports extend", () => {
    expect(r3fNoExtendThreeNamespace.requires).toEqual(["r3f:3"]);
  });

  it("reports Three.js and WebGPU namespace registration", () => {
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
    expect(result.diagnostics).toHaveLength(2);
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
        extend({ Mesh, OrbitControls });
        extend({ Mesh: THREE.Mesh });
      `,
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
