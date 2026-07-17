import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTightAllCapsHeading } from "./no-tight-all-caps-heading.js";

describe("no-tight-all-caps-heading", () => {
  it("flags a long all-caps heading with leading-none", () => {
    const result = runRule(
      noTightAllCapsHeading,
      `const Hero = () => <h1 className="text-7xl uppercase leading-none">Infrastructure for every engineering team</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a short all-caps label", () => {
    const result = runRule(
      noTightAllCapsHeading,
      `const Logo = () => <h2 className="uppercase leading-none">NASA</h2>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows safer leading on a long all-caps heading", () => {
    const result = runRule(
      noTightAllCapsHeading,
      `const Hero = () => <h1 className="text-7xl uppercase leading-[1.05]">Infrastructure for every engineering team</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores headings without letters", () => {
    const result = runRule(
      noTightAllCapsHeading,
      `const Stat = () => <h2 className="leading-none">123456789012345678901234</h2>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
