import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedHoverScale } from "./no-repeated-hover-scale.js";

describe("no-repeated-hover-scale", () => {
  it("flags a repeated hover scale treatment", () => {
    const result = runRule(
      noRepeatedHoverScale,
      `const Grid = () => <main><article className="hover:scale-105" /><article className="hover:scale-105" /><article className="hover:scale-105" /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an isolated hover scale", () => {
    const result = runRule(
      noRepeatedHoverScale,
      `const Grid = () => <main><article className="hover:scale-105" /><article /><article /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count active press feedback or group-hover children", () => {
    const result = runRule(
      noRepeatedHoverScale,
      `const Grid = () => <main><button className="active:scale-95" /><span className="group-hover:scale-105" /><span className="group-hover:scale-105" /><span className="group-hover:scale-105" /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine hover treatments from separate page roots", () => {
    const result = runRule(
      noRepeatedHoverScale,
      `const First = () => <main><article className="hover:scale-105" /><article className="hover:scale-105" /></main>; const Second = () => <main><article className="hover:scale-105" /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
