import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEaseInMotion } from "./no-ease-in-motion.js";

describe("no-ease-in-motion", () => {
  it("flags ease-in in an inline transition", () => {
    const result = runRule(
      noEaseInMotion,
      `const Example = () => <div style={{ transition: "opacity 200ms ease-in" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Motion easeIn configuration", () => {
    const result = runRule(
      noEaseInMotion,
      `import { motion } from "framer-motion"; const Example = () => <motion.div transition={{ ease: "easeIn" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags ease-in nested in a Motion animation target", () => {
    const result = runRule(
      noEaseInMotion,
      `import { motion } from "motion/react"; const Example = () => <motion.div animate={{ x: 20, transition: { ease: "easeIn" } }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the exact Tailwind ease-in utility", () => {
    const result = runRule(
      noEaseInMotion,
      `const Example = () => <div className="transition-opacity ease-in" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not confuse ease-in-out with ease-in", () => {
    const result = runRule(
      noEaseInMotion,
      `const Example = () => <div className="ease-in-out" style={{ transition: "transform 200ms ease-in-out" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ease-out", () => {
    const result = runRule(
      noEaseInMotion,
      `import { motion } from "framer-motion"; const Example = () => <motion.div transition={{ ease: "easeOut" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a custom transition prop as Motion configuration", () => {
    const result = runRule(
      noEaseInMotion,
      `const Example = () => <Carousel transition={{ ease: "easeIn" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report a Motion transition overridden by a later spread", () => {
    const result = runRule(
      noEaseInMotion,
      `import { motion } from "framer-motion"; const Example = ({ props }) => <motion.div transition={{ ease: "easeIn" }} {...props} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
