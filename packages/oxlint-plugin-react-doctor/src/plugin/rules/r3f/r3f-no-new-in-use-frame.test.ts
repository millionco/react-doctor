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

  it.each([
    `const { useFrame } = require("@react-three/fiber"); useFrame(() => new Vector3());`,
    `const { useFrame: frame } = require("@react-three/fiber"); frame(() => new Vector3());`,
    `const Fiber = require("@react-three/fiber"); Fiber.useFrame(() => new Vector3());`,
    `const frame = require("@react-three/fiber").useFrame; frame(() => new Vector3());`,
    `require("@react-three/fiber").useFrame(() => new Vector3());`,
    `import Fiber = require("@react-three/fiber"); Fiber.useFrame(() => new Vector3());`,
  ])("flags allocations through CommonJS and import-equals provenance", (code) => {
    const result = runRule(r3fNoNewInUseFrame, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a shadowed CommonJS require", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const Scene = (require) => { const { useFrame } = require("@react-three/fiber"); useFrame(() => new Vector3()); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores CommonJS hooks from unrelated modules", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const { useFrame } = require("scene-runtime"); useFrame(() => new Vector3());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores mutated CommonJS hook namespaces", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const Fiber = require("@react-three/fiber"); Fiber.useFrame = runOnce; Fiber.useFrame(() => new Vector3());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps calls before a later CommonJS namespace mutation reportable", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const Fiber = require("@react-three/fiber"); Fiber.useFrame(() => new Vector3()); Fiber.useFrame = runOnce;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not reinterpret a CommonJS member binding as the module namespace", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const scheduler = require("@react-three/fiber").advance; scheduler.useFrame(() => new Vector3());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows synchronously called callbacks", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import { useFrame } from "@react-three/fiber"; useFrame(() => { events.map(() => new Event()); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves callbacks wrapped by imported React useCallback", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       import { useCallback as stabilize } from "react";
       const Scene = () => {
         const update = stabilize(() => new Vector3(), []);
         useFrame(update);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const { useFrame } = require("@react-three/fiber"); const React = require("react"); const update = React.useCallback(() => new Vector3(), []); useFrame(update);`,
    `const { useFrame } = require("@react-three/fiber"); const { useCallback: stabilize } = require("react"); const update = stabilize(() => new Vector3(), []); useFrame(update);`,
    `const { useFrame } = require("@react-three/fiber"); useFrame(require("react").useCallback(() => new Vector3(), []));`,
    `import Fiber = require("@react-three/fiber"); import React = require("react"); Fiber.useFrame(React.useCallback(() => new Vector3(), []));`,
  ])("resolves callbacks wrapped by CommonJS React useCallback", (code) => {
    const result = runRule(r3fNoNewInUseFrame, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores React callbacks loaded through a shadowed require", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const { useFrame } = require("@react-three/fiber"); const Scene = (require) => { const React = require("react"); useFrame(React.useCallback(() => new Vector3(), [])); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores mutated CommonJS React callback namespaces", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `const Fiber = require("@react-three/fiber"); const React = require("react"); React.useCallback = discard; const update = React.useCallback(() => new Vector3(), []); Fiber.useFrame(update);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves qualified TypeScript import-equals aliases", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import Fiber = require("@react-three/fiber"); import React = require("react"); import frame = Fiber.useFrame; import memo = React.useCallback; frame(memo(() => new Vector3(), []));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores qualified TypeScript aliases captured after a namespace mutation", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import Fiber = require("@react-three/fiber"); Fiber.useFrame = runOnce; import frame = Fiber.useFrame; frame(() => new Vector3());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores callbacks wrapped by an unrelated useCallback", () => {
    const result = runRule(
      r3fNoNewInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       const useCallback = (callback) => callback;
       const Scene = () => {
         const update = useCallback(() => new Vector3(), []);
         useFrame(update);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
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
