import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativeBlurOrb } from "./no-decorative-blur-orb.js";

describe("no-decorative-blur-orb", () => {
  it("flags an empty oversized blurred color orb", () => {
    const result = runRule(
      noDecorativeBlurOrb,
      `const Hero = () => <div className="pointer-events-none absolute size-96 rounded-full bg-purple-500 blur-3xl" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a strongly blurred orb with an arbitrary blur", () => {
    const result = runRule(
      noDecorativeBlurOrb,
      `const Hero = () => <span className="fixed h-64 w-64 rounded-full bg-cyan-300/50 blur-[40px]" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts blurred content and functional circular controls", () => {
    const result = runRule(
      noDecorativeBlurOrb,
      `const Card = () => <><div className="absolute rounded-full bg-blue-500 blur-3xl">Status</div><button className="absolute size-12 rounded-full bg-blue-500 blur-sm">Open</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
