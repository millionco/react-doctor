import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoAsyncUseFrame } from "./r3f-no-async-use-frame.js";

describe("r3f-no-async-use-frame", () => {
  it("flags async callbacks resolved through a namespace import", () => {
    const result = runRule(
      r3fNoAsyncUseFrame,
      `import * as Fiber from "@react-three/fiber"; Fiber.useFrame(async () => { await load(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows synchronous callbacks", () => {
    const result = runRule(
      r3fNoAsyncUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => update());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("describes ignored promises even when the callback has no await", () => {
    const result = runRule(
      r3fNoAsyncUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(async () => update());`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("ignored Promise");
  });

  it("flags async callbacks wrapped by React useCallback", () => {
    const result = runRule(
      r3fNoAsyncUseFrame,
      `import * as Fiber from "@react-three/fiber";
       import React from "react";
       const Scene = () => {
         const update = React.useCallback(async () => loadAssets(), []);
         Fiber.useFrame(update);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["@react-three/fiber/native", "@react-three/fiber/legacy", "@react-three/fiber/webgpu"])(
    "recognizes the public %s entry point",
    (moduleSource) => {
      const result = runRule(
        r3fNoAsyncUseFrame,
        `import { useFrame } from "${moduleSource}"; useFrame(async () => update());`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
