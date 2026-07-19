import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireRootUnmount } from "./r3f-require-root-unmount.js";

describe("r3f-require-root-unmount", () => {
  it("reports component-owned roots without unmount cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { createRoot } from "@react-three/fiber";
      function Scene({ canvas }) {
        useEffect(() => {
          const root = createRoot(canvas);
          root.configure({ frameloop: "demand" });
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(1);
  });

  it("supports named aliases, namespaces, native, and CommonJS", () => {
    const code = `
      import { useEffect } from "react";
      import { createRoot as mountRoot } from "@react-three/fiber/native";
      import * as Fiber from "@react-three/fiber";
      function Scene({ firstCanvas, secondCanvas }) {
        useEffect(() => { const first = mountRoot(firstCanvas); first.configure({}); }, [firstCanvas]);
        useEffect(() => { const second = Fiber.createRoot(secondCanvas); second.configure({}); }, [secondCanvas]);
        return null;
      }
      const React = require("react");
      const R3F = require("@react-three/fiber/webgpu");
      function Other({ canvas }) {
        React.useEffect(() => { const root = R3F.createRoot(canvas); root.configure({}); }, [canvas]);
        return null;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(3);
  });

  it("accepts exact unmount cleanup and aliases", () => {
    const code = `
      import { useEffect } from "react";
      import { createRoot } from "@react-three/fiber";
      function Scene({ canvas }) {
        useEffect(() => {
          const root = createRoot(canvas);
          const rootAlias = root;
          return () => rootAlias.unmount();
        }, [canvas]);
        return null;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(0);
  });

  it("requires React to invoke a disposer returned by a custom hook", () => {
    const code = `
      import { createRoot } from "@react-three/fiber";
      function useRootDisposer(canvas) {
        const root = createRoot(canvas);
        root.configure({});
        const remove = () => root.unmount();
        return remove;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(1);
  });

  it("requires React to invoke disposers transferred through hook results", () => {
    const code = `
      import { createRoot } from "@react-three/fiber";
      function useObjectRoot(canvas) {
        const root = createRoot(canvas);
        root.configure({});
        const onRemove = () => root.unmount();
        return { onRemove };
      }
      function useArrayRoot(canvas) {
        const root = createRoot(canvas);
        root.configure({});
        const disposeRoot = () => root.unmount();
        return [disposeRoot];
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(2);
  });

  it("does not confuse nested callbacks with returned cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { createRoot } from "@react-three/fiber";
      function Scene({ canvas, ready }) {
        useEffect(() => {
          const root = createRoot(canvas);
          ready.then(() => () => root.unmount());
        }, [canvas, ready]);
        return null;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(1);
  });

  it("stays quiet for module roots and transferred ownership", () => {
    const code = `
      import { createRoot } from "@react-three/fiber";
      const applicationRoot = createRoot(document.querySelector("canvas"));
      function useRoot(canvas, manager) {
        const returnedRoot = createRoot(canvas);
        const managedRoot = createRoot(canvas);
        manager.adopt(managedRoot);
        return returnedRoot;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(0);
  });

  it("ignores react-dom, unrelated createRoot, shadowing, and event handlers", () => {
    const code = `
      import { createRoot } from "react-dom/client";
      import { createRoot as createStore } from "state-library";
      import * as Fiber from "@react-three/fiber";
      function Scene({ canvas }) {
        const handleClick = () => Fiber.createRoot(canvas);
        const Fiber = { createRoot: createStore };
        createRoot(document.body);
        return <button onClick={handleClick} />;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(0);
  });

  it("ignores createRoot through a shadowed require", () => {
    const code = `
      function Scene(require, canvas) {
        const Fiber = require("@react-three/fiber");
        const root = Fiber.createRoot(canvas);
        root.configure({});
        return null;
      }
    `;
    expect(runRule(r3fRequireRootUnmount, code).diagnostics).toHaveLength(0);
  });
});
