import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMixedAnimationOwners } from "./no-mixed-animation-owners.js";

describe("no-mixed-animation-owners", () => {
  it("reports Motion and Tailwind transitions that own the same property", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 100 }} className="transition-transform" />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity duration-200" />
         <motion.div animate={{ backgroundColor: "red" }} className="transition-colors" />
         <motion.div animate={{ boxShadow: "0 0 10px red" }} className="transition-shadow" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("normalizes Motion transform aliases and camel-cased CSS keys", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { m } from "framer-motion";
       const Demo = () => <>
         <m.div animate={{ y: 20, rotateZ: 10, transformPerspective: 800 }} className="transition-transform" />
         <m.div animate={{ borderTopColor: "red" }} className="transition-[border-top-color]" />
         <m.div exit={{ transformOrigin: "center" }} className="transition-[transform-origin]" />
         <m.div animate={{ WebkitFilter: "blur(0)" }} className="transition-[-webkit-filter]" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports authoritative static target objects through supported Motion imports", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion as animated } from "framer-motion";
       import * as Motion from "motion/react";
       import { div as MotionDiv } from "motion/react-m";
       const Factory = animated;
       const Created = animated.create("div");
       const Demo = () => <>
         <animated.div animate={{ opacity: 1 }} className="transition-opacity" />
         <Motion.motion.div animate={{ x: 1 }} className="transition-transform" />
         <MotionDiv animate={{ color: "red" }} className="transition-colors" />
         <Factory.div animate={{ scale: 1 }} className="transition-transform" />
         <Created animate={{ filter: "blur(0)" }} className="transition-[filter] duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("reports positive inline transitions and property-duration lists", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const opacityTransition = { transitionProperty: "opacity", transitionDuration: "200ms" };
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} style={{ transition: "transform 150ms ease" }} />
         <motion.div animate={{ opacity: 1 }} style={opacityTransition} />
         <motion.div animate={{ color: "red" }} style={{ transitionProperty: "opacity, color", transitionDuration: "0ms, 120ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("merges statically effective Tailwind and inline transition declarations", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="duration-200" style={{ transitionProperty: "transform" }} />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity" style={{ transitionDuration: "250ms" }} />
         <motion.div animate={{ color: "red" }} className="!transition-colors" style={{ transitionProperty: "opacity" }} />
         <motion.div animate={{ x: 10 }} className="!duration-200" style={{ transition: "transform 0ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("supports exact arbitrary Tailwind transition declarations", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="transition-[opacity] duration-[175ms]" />
         <motion.div animate={{ x: 10 }} className="[transition-property:transform] [transition-duration:0.2s]" />
         <motion.div animate={{ color: "red" }} className="[transition:color_120ms_ease-out]" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("uses Tailwind v4 individual transform and outline transition properties", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ translate: "10px" }} className="transition-transform" />
         <motion.div animate={{ outlineColor: "red" }} className="transition-colors" />
       </>;`,
      { settings: { "react-doctor": { capabilities: ["tailwind", "tailwind:4"] } } },
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not assume Tailwind v4-only transition properties in older projects", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ translate: "10px" }} className="transition-transform" />
         <motion.div animate={{ outlineColor: "red" }} className="transition-colors" />
       </>;`,
      { settings: { "react-doctor": { capabilities: ["tailwind"] } } },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows different Motion and CSS transition properties", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="transition-transform" />
         <motion.div animate={{ color: "red" }} style={{ transition: "background-color 200ms" }} />
         <motion.div animate={{ boxShadow: "none" }} className="transition-colors" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps parent and child animation ownership separate", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }}><span className="transition-transform" /></motion.div>
         <motion.div className="transition-transform"><motion.span animate={{ x: 10 }} /></motion.div>
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores Tailwind transitions that target descendants or pseudo-elements", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="[&>span]:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="[&_span]:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="before:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="after:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="*:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="group-hover:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="peer-focus:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="has-[span]:transition-opacity" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an exact arbitrary self selector", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <motion.div animate={{ opacity: 1 }} className="[&]:transition-opacity" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires local data variants to match static attributes", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = ({ state }) => <>
         <motion.div data-state="open" animate={{ opacity: 1 }} className="data-[state=open]:transition-opacity" />
         <motion.div data-state="closed" animate={{ opacity: 1 }} className="data-[state=open]:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="data-[state=open]:transition-opacity" />
         <motion.div data-state={state} animate={{ opacity: 1 }} className="data-[state=open]:transition-opacity" />
         <motion.div data-active="" animate={{ opacity: 1 }} className="data-active:transition-opacity" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("requires local ARIA variants to match static attributes", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = ({ expanded }) => <>
         <motion.button aria-expanded="true" animate={{ opacity: 1 }} className="aria-[expanded=true]:transition-opacity" />
         <motion.button aria-expanded="false" animate={{ opacity: 1 }} className="aria-[expanded=true]:transition-opacity" />
         <motion.button animate={{ opacity: 1 }} className="aria-[expanded=true]:transition-opacity" />
         <motion.button aria-expanded={expanded} animate={{ opacity: 1 }} className="aria-[expanded=true]:transition-opacity" />
         <motion.button aria-pressed={true} animate={{ opacity: 1 }} className="aria-pressed:transition-opacity" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("suppresses transition-all ownership handled by no-transition-all", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="transition-all" />
         <motion.div animate={{ opacity: 1 }} style={{ transition: "all 200ms" }} />
         <motion.div animate={{ color: "red" }} className="[transition-property:all] duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for CSS custom and non-interpolable transition properties", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ "--progress": 1 }} style={{ transition: "--progress 200ms" }} />
         <motion.div animate={{ display: "none" }} style={{ transition: "display 200ms" }} />
         <motion.div animate={{ pointerEvents: "none" }} className="transition-[pointer-events]" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows zero-duration and disabled transitions", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="transition-transform duration-0" />
         <motion.div animate={{ opacity: 1 }} className="transition-none duration-200" />
         <motion.div animate={{ color: "red" }} style={{ transition: "color 0ms" }} />
         <motion.div animate={{ filter: "none" }} style={{ transitionProperty: "filter", transitionDuration: "0s" }} />
         <motion.div initial={{ opacity: 0 }} className="transition-opacity" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for conflicting Tailwind properties and durations", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="transition-transform transition-opacity" />
         <motion.div animate={{ x: 10 }} className="transition-transform duration-0 duration-200" />
         <motion.div animate={{ opacity: 1 }} className="!transition-opacity !transition-transform" />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity !duration-0 !duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects important precedence when Tailwind and inline styles conflict", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="!transition-none" style={{ transition: "transform 200ms" }} />
         <motion.div animate={{ opacity: 1 }} className="!duration-0 transition-opacity" style={{ transitionDuration: "200ms" }} />
         <motion.div animate={{ x: 10 }} className="transition-transform" style={{ transitionProperty: "opacity" }} />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity duration-0" style={{ transitionDuration: "200ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes co-executing interaction states and explicit exclusions", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div whileHover={{ x: 10 }} className="hover:transition-transform" />
         <motion.div whileFocus={{ opacity: 1 }} className="focus-visible:transition-opacity" />
         <motion.div whileTap={{ scale: 0.9 }} className="active:transition-transform" />
         <motion.div whileHover={{ x: 10 }} className="focus:transition-transform" />
         <motion.div whileFocus={{ opacity: 1 }} className="hover:transition-opacity" />
         <motion.div whileTap={{ scale: 0.9 }} className="focus:transition-transform" />
         <motion.div whileHover={{ x: 10 }} className="not-hover:transition-transform" />
         <motion.div whileFocus={{ opacity: 1 }} className="not-focus:transition-opacity" />
         <motion.div whileTap={{ scale: 0.9 }} className="not-active:transition-transform" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(6);
  });

  it("reports base transitions that overlap gesture-owned properties", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div whileHover={{ x: 10 }} className="transition-transform" />
         <motion.div whileFocus={{ opacity: 1 }} style={{ transition: "opacity 200ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports drag and in-view ownership across base and responsive scopes", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div whileDrag={{ x: 10 }} className="transition-transform" />
         <motion.div whileInView={{ opacity: 1 }} className="md:transition-opacity" />
         <motion.div whileDrag={{ color: "red" }} className="focus:transition-colors" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("uses matching state overrides before considering a base inline transition", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div whileHover={{ x: 10 }} className="hover:!transition-none" style={{ transition: "transform 200ms" }} />
         <motion.div whileFocus={{ opacity: 1 }} className="focus:!duration-0" style={{ transition: "opacity 200ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses effective nested Tailwind scopes for property and duration", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div whileHover={{ x: 10 }} className="md:hover:transition-transform md:hover:duration-200" />
         <motion.div whileHover={{ x: 10 }} className="hover:[transition-property:transform] focus:duration-200" />
         <motion.div whileHover={{ x: 10 }} className="hover:[transition-property:transform] hover:duration-0 focus:duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("combines proven co-executing property and duration scopes", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className="md:[transition-property:transform] hover:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="motion-safe:[transition-property:opacity] dark:duration-200" />
         <motion.div animate={{ color: "red" }} className="focus:[transition-property:color] hover:duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not combine mutually exclusive Tailwind scopes", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="motion-safe:[transition-property:opacity] motion-reduce:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="portrait:[transition-property:opacity] landscape:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="lg:[transition-property:opacity] max-md:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="data-[state=open]:[transition-property:opacity] data-[state=closed]:duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects internally contradictory transition scopes", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="motion-safe:motion-reduce:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="portrait:landscape:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="md:max-md:transition-opacity" />
         <motion.div animate={{ opacity: 1 }} className="data-[state=open]:data-[state=closed]:transition-opacity" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine additional mutually exclusive state families", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="in-range:[transition-property:opacity] out-of-range:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="read-only:[transition-property:opacity] read-write:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="pointer-coarse:[transition-property:opacity] pointer-fine:duration-200" />
         <motion.a animate={{ opacity: 1 }} className="link:[transition-property:opacity] visited:duration-200" />
         <motion.div animate={{ opacity: 1 }} className="odd:[transition-property:opacity] even:duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report phantom base states covered by exhaustive transition overrides", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="transition-opacity motion-safe:transition-none motion-reduce:transition-none" />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity max-md:transition-none md:transition-none" />
         <motion.div animate={{ opacity: 1 }} className="motion-safe:!transition-none motion-reduce:!transition-none" style={{ transition: "opacity 200ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("retains reachable base states outside incomplete or qualified partitions", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="transition-opacity motion-safe:transition-none" />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity max-md:transition-none" />
         <motion.div animate={{ opacity: 1 }} className="transition-opacity dark:motion-safe:transition-none dark:motion-reduce:transition-none" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("stays quiet for dynamic Motion targets and target spreads", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const target = { opacity: 1 };
       const Demo = ({ animate, keyName, props }) => <>
         <motion.div animate={animate} className="transition-opacity" />
         <motion.div animate={target} className="transition-opacity" />
         <motion.div animate={{ [keyName]: 1 }} className="transition-opacity" />
         <motion.div animate={{ ...props, opacity: 1 }} className="transition-opacity" />
         <motion.div animate={{ opacity: 1 }} {...props} className="transition-opacity" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts fully static inline target spreads", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <motion.div animate={{ ...{ opacity: 1 } }} className="transition-opacity" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for dynamic classes and styles", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = ({ className, style, enabled }) => <>
         <motion.div animate={{ opacity: 1 }} className={className} />
         <motion.div animate={{ opacity: 1 }} style={style} />
         <motion.div animate={{ opacity: 1 }} className={\`transition-opacity \${className}\`} />
         <motion.div animate={{ opacity: 1 }} className={enabled ? "transition-opacity" : className} />
         <motion.div animate={{ opacity: 1 }} style={{ ...style, transition: "opacity 200ms" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("folds unreachable literal className branches", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.div animate={{ x: 10 }} className={false ? "transition-transform" : "transition-opacity"} />
         <motion.div animate={{ x: 10 }} className={true ? "transition-transform" : "transition-opacity"} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for custom Motion lookalikes, type imports, and shadowed bindings", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import type { motion as MotionType } from "motion/react";
       import { motion as importedMotion } from "motion/react";
       const motion = { div: "div" };
       const Custom = ({ animate, className }) => <div />;
       const Demo = () => <>
         <motion.div animate={{ opacity: 1 }} className="transition-opacity" />
         <Custom animate={{ opacity: 1 }} className="transition-opacity" />
         <MotionType.div animate={{ opacity: 1 }} className="transition-opacity" />
       </>;
       const Shadowed = () => { const importedMotion = { div: "div" }; return <importedMotion.div animate={{ opacity: 1 }} className="transition-opacity" />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores Motion metadata and SVG attribute-only target keys", () => {
    const result = runRule(
      noMixedAnimationOwners,
      `import { motion } from "motion/react";
       const Demo = () => <>
         <motion.path animate={{ transition: { duration: 1 }, transitionEnd: { opacity: 0 } }} className="transition-opacity" />
         <motion.path animate={{ pathLength: 1, attrX: 10 }} className="transition-[path-length] duration-200" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
