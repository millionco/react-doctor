import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionCreateInRender } from "./motion-create-in-render.js";

describe("motion-create-in-render", () => {
  it("reports direct, aliased, namespace, and synchronous nested render calls", () => {
    const result = runRule(
      motionCreateInRender,
      `import { motion as animate } from "motion/react";
       import * as Motion from "framer-motion";
       const A = () => { const Item = animate.create("div"); return <Item />; };
       const B = () => ["div"].map((tag) => Motion.motion.create(tag));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows module scope, stable React initializers, and deferred callbacks", () => {
    const result = runRule(
      motionCreateInRender,
      `import { motion } from "motion/react";
       import { useMemo, useState } from "react";
       const StaticItem = motion.create("div");
       const Panel = () => {
         const MemoItem = useMemo(() => motion.create("section"), []);
         const [LazyItem] = useState(() => motion.create("aside"));
         const onClick = () => motion.create("button");
         return <MemoItem onClick={onClick}><LazyItem /></MemoItem>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports useMemo without a dependency array", () => {
    const result = runRule(
      motionCreateInRender,
      `import { motion } from "motion/react";
       import { useMemo } from "react";
       const Panel = () => {
         const Item = useMemo(() => motion.create("div"));
         return <Item />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores same-named local APIs", () => {
    const result = runRule(
      motionCreateInRender,
      `const motion = { create: (tag) => tag }; const Panel = () => motion.create("div");`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
