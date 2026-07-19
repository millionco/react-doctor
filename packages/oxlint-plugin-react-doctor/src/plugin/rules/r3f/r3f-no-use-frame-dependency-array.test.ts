import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoUseFrameDependencyArray } from "./r3f-no-use-frame-dependency-array.js";

describe("r3f-no-use-frame-dependency-array", () => {
  it("requires the numeric-priority useFrame contract", () => {
    expect(r3fNoUseFrameDependencyArray.requires).toEqual(["r3f:3"]);
  });

  it.each([
    "@react-three/fiber",
    "@react-three/fiber/native",
    "@react-three/fiber/legacy",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
  ])("reports an array passed through %s", (moduleSource) => {
    const result = runRule(
      r3fNoUseFrameDependencyArray,
      `import { useFrame } from "${moduleSource}"; useFrame(() => update(), []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports renamed, namespace, computed, and const-aliased calls", () => {
    const code = `
      import { useFrame as scheduleFrame } from "@react-three/fiber";
      import * as Fiber from "@react-three/fiber";
      const dependencies = [] as unknown as number;
      const frame = scheduleFrame;
      frame(() => update(), dependencies);
      Fiber.useFrame(() => update(), [priority]);
      Fiber["useFrame"](() => update(), []);
    `;
    const result = runRule(r3fNoUseFrameDependencyArray, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows supported and unresolved scheduling arguments", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      useFrame(() => update());
      useFrame(() => update(), 0);
      useFrame(() => update(), -1);
      useFrame(() => update(), renderPriority);
      useFrame(() => update(), { phase: "physics" });
      useFrame(() => update(), { priority: 2, fps: 30 });
    `;
    const result = runRule(r3fNoUseFrameDependencyArray, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated and shadowed useFrame functions", () => {
    const code = `
      import { useFrame as otherUseFrame } from "animation-library";
      import { useFrame } from "@react-three/fiber";
      otherUseFrame(() => update(), []);
      function configure(useFrame) {
        useFrame(() => update(), []);
      }
    `;
    const result = runRule(r3fNoUseFrameDependencyArray, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
