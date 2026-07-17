import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHoverOnlyReveal } from "./no-hover-only-reveal.js";

describe("no-hover-only-reveal", () => {
  it("reports direct and grouped hover-only reveals", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <><button className="opacity-0 hover:opacity-100" /><button className="invisible group-hover:visible" /><div className="hidden group-hover:flex" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows matching keyboard reveals", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <><button className="opacity-0 hover:opacity-100 focus-visible:opacity-100" /><button className="invisible group-hover:visible group-focus-within:visible" /><div className="hidden group-hover:flex group-focus:flex" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports Motion opacity revealed only on hover", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `import { motion } from "motion/react";
       const Actions = () => <>
         <motion.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} />
         <motion.div animate={{ opacity: 0 }} whileHover={{ opacity: 0.8 }} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows Motion focus reveals and skips dynamic or unrelated components", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `import { motion } from "motion/react";
       const Fake = { button: "button" };
       const Actions = ({ initial }) => <>
         <motion.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} whileFocus={{ opacity: 1 }} />
         <motion.button initial={initial} whileHover={{ opacity: 1 }} />
         <Fake.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips visible rest states, dynamic classes, and spreads", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = ({ className, props }) => <><button className="hover:opacity-100" /><button className={className} /><button className="opacity-0 hover:opacity-100" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
