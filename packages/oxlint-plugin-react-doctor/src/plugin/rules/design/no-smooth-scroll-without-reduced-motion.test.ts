import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSmoothScrollWithoutReducedMotion } from "./no-smooth-scroll-without-reduced-motion.js";

describe("no-smooth-scroll-without-reduced-motion", () => {
  it("reports literal inline smooth scrolling", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <main style={{ scrollBehavior: "smooth" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an unconditional Tailwind utility", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const Page = () => <main className="h-screen overflow-auto scroll-smooth" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows motion-safe and reduced-motion fallback utilities", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const A = () => <main className="motion-safe:scroll-smooth" />;
       const B = () => <main className="scroll-smooth motion-reduce:scroll-auto" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows instant and dynamic inline behavior", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const A = () => <main style={{ scrollBehavior: "auto" }} />;
       const B = ({ reduced }) => <main style={{ scrollBehavior: reduced ? "auto" : "smooth" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic class names and authoritative spreads", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      `const A = ({ className }) => <main className={className} />;
       const B = ({ style }) => <main style={{ scrollBehavior: "smooth", ...style }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
