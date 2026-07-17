import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUngatedTailwindAnimation } from "./no-ungated-tailwind-animation.js";

describe("no-ungated-tailwind-animation", () => {
  it("reports base and responsive animations without a reduced-motion path", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <><span className="animate-spin" /><span className="md:animate-[float_2s_infinite]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows motion-safe gating and reduced-motion overrides", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = () => <><span className="motion-safe:animate-spin" /><span className="animate-pulse motion-reduce:animate-none" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips animate-none, dynamic classes, and spread-owned props", () => {
    const result = runRule(
      noUngatedTailwindAnimation,
      `const Status = ({ className, props }) => <><span className="animate-none" /><span className={className} /><span className="animate-spin" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
