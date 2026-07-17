import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { requireScaleRevealTransformOrigin } from "./require-scale-reveal-transform-origin.js";

describe("require-scale-reveal-transform-origin", () => {
  it("flags a proven Motion menu that scales without an origin", () => {
    const result = runRule(
      requireScaleRevealTransformOrigin,
      `import { motion } from "motion/react"; const Menu = () => <motion.div role="menu" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts Tailwind and inline transform origins", () => {
    const result = runRule(
      requireScaleRevealTransformOrigin,
      `import { motion } from "motion/react"; const Menus = () => <><motion.div role="menu" className="origin-top-right" initial={{ scale: 0.96 }} /><motion.div role="listbox" style={{ transformOrigin: "top" }} exit={{ scale: 0.98 }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts non-scaling menus and centered dialogs", () => {
    const result = runRule(
      requireScaleRevealTransformOrigin,
      `import { motion } from "motion/react"; const Overlays = () => <><motion.div role="menu" initial={{ opacity: 0 }} /><motion.div role="dialog" initial={{ scale: 0.95 }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unproven motion-like components and dynamic configs", () => {
    const result = runRule(
      requireScaleRevealTransformOrigin,
      `const Menus = ({ initial }) => <><motion.div role="menu" initial={{ scale: 0.95 }} /><AnimatedMenu role="menu" initial={initial} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
