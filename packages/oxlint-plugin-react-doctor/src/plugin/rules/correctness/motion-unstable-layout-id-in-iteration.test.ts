import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionUnstableLayoutIdInIteration } from "./motion-unstable-layout-id-in-iteration.js";

describe("motion-unstable-layout-id-in-iteration", () => {
  it("reports static and index-derived layout IDs inside map callbacks", () => {
    const result = runRule(
      motionUnstableLayoutIdInIteration,
      `import { motion } from "motion/react";
       const List = ({ items }) => items.map((item, index) => {
         const markerId = index;
         return <>
         <motion.div layoutId="card" />
         <motion.span layoutId={index} />
         <motion.i layoutId={\`marker-\${markerId}\`} />
       </>;
       });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows IDs derived from stable item identity", () => {
    const result = runRule(
      motionUnstableLayoutIdInIteration,
      `import { motion } from "framer-motion";
       const List = ({ items }) => items.map((item) => <>
         <motion.div layoutId={item.id} />
         <motion.span layoutId={\`marker-\${item.id}\`} />
       </>);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores static IDs outside iteration and userland motion lookalikes", () => {
    const result = runRule(
      motionUnstableLayoutIdInIteration,
      `import { motion as localMotion } from "./motion";
       import { motion } from "motion/react";
       const Static = () => <motion.div layoutId="underline" />;
       const List = ({ items }) => items.map(() => <localMotion.div layoutId="card" />);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows conditional shared markers and item-scoped LayoutGroups", () => {
    const result = runRule(
      motionUnstableLayoutIdInIteration,
      `import { LayoutGroup, motion } from "motion/react";
       const List = ({ items }) => items.map((item) => <>
         {item.selected && <motion.div layoutId="underline" />}
         <LayoutGroup id={item.id}><motion.div layoutId="card" /></LayoutGroup>
       </>);`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
