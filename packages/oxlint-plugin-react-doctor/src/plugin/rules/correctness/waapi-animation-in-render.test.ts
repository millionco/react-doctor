import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { waapiAnimationInRender } from "./waapi-animation-in-render.js";

describe("waapi-animation-in-render", () => {
  it("reports Web Animations started directly during component and hook render", () => {
    const result = runRule(
      waapiAnimationInRender,
      `const Panel = () => {
         document.body.animate([{ opacity: 0 }, { opacity: 1 }], 200);
         return <div />;
       };
       const usePanelAnimation = () => {
         const panel = document.querySelector(".panel");
         panel.animate({ transform: ["scale(.9)", "scale(1)"] }, 200);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports proven receiver aliases, computed animate access, and typed DOM refs", () => {
    const result = runRule(
      waapiAnimationInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const panel = document.createElement("div");
         const target = panel;
         const ref = useRef<HTMLDivElement>(null);
         target["animate"]({ opacity: [0, 1] }, 200);
         ref.current!.animate({ opacity: [0, 1] }, 200);
         return <div ref={ref} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports synchronous iteration, useMemo, IIFE, and Promise executor calls", () => {
    const result = runRule(
      waapiAnimationInRender,
      `import { useMemo } from "react";
       const Panel = ({ items }) => {
         items.forEach(() => document.body.animate({ opacity: [0, 1] }, 200));
         useMemo(() => document.body.animate({ opacity: [0, 1] }, 200), []);
         (() => document.body.animate({ opacity: [0, 1] }, 200))();
         new Promise(() => document.body.animate({ opacity: [0, 1] }, 200));
         return <div />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("allows effects, event handlers, and deferred callbacks", () => {
    const result = runRule(
      waapiAnimationInRender,
      `import { useEffect, useLayoutEffect } from "react";
       const Panel = () => {
         useEffect(() => document.body.animate({ opacity: [0, 1] }, 200), []);
         useLayoutEffect(() => document.body.animate({ opacity: [0, 1] }, 200), []);
         const handleClick = () => document.body.animate({ opacity: [0, 1] }, 200);
         setTimeout(() => document.body.animate({ opacity: [0, 1] }, 200), 0);
         queueMicrotask(() => document.body.animate({ opacity: [0, 1] }, 200));
         requestAnimationFrame(() => document.body.animate({ opacity: [0, 1] }, 200));
         Promise.resolve().then(() => document.body.animate({ opacity: [0, 1] }, 200));
         return <button onClick={handleClick}>Animate</button>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows module-scope animation calls", () => {
    const result = runRule(
      waapiAnimationInRender,
      `document.body.animate({ opacity: [0, 1] }, 200);
       const Panel = () => <div />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows userland animate methods and dynamically computed methods", () => {
    const result = runRule(
      waapiAnimationInRender,
      `const Panel = ({ chart, method }) => {
         const timeline = { animate() {} };
         timeline.animate();
         chart.animate();
         document.body[method]({ opacity: [0, 1] }, 200);
         return <div />;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows shadowed browser globals", () => {
    const result = runRule(
      waapiAnimationInRender,
      `const Panel = () => {
         const document = { body: { animate() {} } };
         document.body.animate();
         return <div />;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows imported Motion animate APIs", () => {
    const result = runRule(
      waapiAnimationInRender,
      `import { animate } from "motion/react";
       import * as Motion from "framer-motion";
       const Panel = () => {
         animate(".panel", { opacity: 1 });
         Motion.animate(".panel", { opacity: 1 });
         return <div />;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
