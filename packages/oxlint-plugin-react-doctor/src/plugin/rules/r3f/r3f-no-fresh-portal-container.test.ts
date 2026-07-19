import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoFreshPortalContainer } from "./r3f-no-fresh-portal-container.js";

describe("r3f-no-fresh-portal-container", () => {
  it("reports constructed, cloned, and local const containers during render", () => {
    const code = `
      import { createPortal } from "@react-three/fiber";
      import { Scene } from "three";
      function World({ source }) {
        const localScene = new Scene();
        return <>{createPortal(<mesh />, new Scene())}{createPortal(<mesh />, source.clone())}{createPortal(<mesh />, localScene)}</>;
      }
    `;
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports a freshly constructed container after a fluent add call", () => {
    const result = runRule(
      r3fNoFreshPortalContainer,
      `import { createPortal } from "@react-three/fiber"; import { Scene } from "three"; const World = () => createPortal(<mesh />, new Scene().add(child));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves renamed, namespace, and public-entry-point calls", () => {
    const code = `
      import { createPortal as mountPortal } from "@react-three/fiber/native";
      import * as Fiber from "@react-three/fiber/webgpu";
      import { Scene } from "three";
      const NativeWorld = () => mountPortal(<mesh />, new Scene());
      const WebGpuWorld = () => Fiber.createPortal(<mesh />, new Scene());
    `;
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("checks every conditional and logical branch for fresh portal containers", () => {
    const code = `
      import { createPortal } from "@react-three/fiber";
      import { Scene } from "three";
      function World({ enabled, scene, source }) {
        const conditionalContainer = enabled ? {} : new Scene();
        const logicalContainer = scene || source.clone();
        return <>
          {createPortal(<mesh />, conditionalContainer)}
          {createPortal(<mesh />, logicalContainer)}
        </>;
      }
    `;
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows stable module, memoized, lazy-state, and caller-owned containers", () => {
    const code = `
      import { createPortal } from "@react-three/fiber";
      import { Scene } from "three";
      import { useMemo, useState } from "react";
      const moduleScene = new Scene();
      function World({ scene }) {
        const memoScene = useMemo(() => new Scene(), []);
        const [lazyScene] = useState(() => new Scene());
        return <>{createPortal(<mesh />, moduleScene)}{createPortal(<mesh />, memoScene)}{createPortal(<mesh />, lazyScene)}{createPortal(<mesh />, scene)}</>;
      }
    `;
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores module-scope portals and unrelated createPortal functions", () => {
    const code = `
      import { createPortal } from "@react-three/fiber";
      import { createPortal as createDomPortal } from "react-dom";
      import { Scene } from "three";
      const node = createPortal(<mesh />, new Scene());
      function World() {
        return createDomPortal(<div />, new Scene());
      }
    `;
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows portals retained by memo, state, and ref initialization", () => {
    const code = `
      import { createPortal } from "@react-three/fiber";
      import { useMemo, useRef, useState } from "react";
      import { Scene } from "three";
      function World() {
        const memoizedPortal = useMemo(() => createPortal(<mesh />, new Scene()), []);
        const [lazyPortal] = useState(() => createPortal(<mesh />, new Scene()));
        const eagerStatePortal = useState(createPortal(<mesh />, new Scene()))[0];
        const refPortal = useRef(createPortal(<mesh />, new Scene())).current;
        return <>{memoizedPortal}{lazyPortal}{eagerStatePortal}{refPortal}</>;
      }
    `;
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const Fiber = require("@react-three/fiber"); const React = require("react"); const THREE = require("three"); const World = () => React.useMemo(() => Fiber.createPortal(<mesh />, new THREE.Scene()), []);`,
    `const { createPortal } = require("@react-three/fiber"); const { useState } = require("react"); const { Scene } = require("three"); const World = () => useState(() => createPortal(<mesh />, new Scene()))[0];`,
    `const Fiber = require("@react-three/fiber"); const React = require("react"); const THREE = require("three"); const World = () => React.useRef(Fiber.createPortal(<mesh />, new THREE.Scene())).current;`,
    `import Fiber = require("@react-three/fiber"); import React = require("react"); import THREE = require("three"); const World = () => React.useMemo(() => Fiber.createPortal(<mesh />, new THREE.Scene()), []);`,
  ])("allows portals retained by CommonJS React hooks", (code) => {
    const result = runRule(r3fNoFreshPortalContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports portals passed to a mutated CommonJS React hook", () => {
    const result = runRule(
      r3fNoFreshPortalContainer,
      `const Fiber = require("@react-three/fiber"); const React = require("react"); const THREE = require("three"); React.useState = createState; const World = () => React.useState(Fiber.createPortal(<mesh />, new THREE.Scene()))[0];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
