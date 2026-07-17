import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTightDisplayTracking } from "./no-tight-display-tracking.js";

describe("no-tight-display-tracking", () => {
  it("flags the tightest Tailwind tracking on display headings", () => {
    const result = runRule(
      noTightDisplayTracking,
      `const Hero = () => <h1 className="text-7xl font-bold tracking-tighter">Build your next idea</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts ordinary tracking and compact metadata", () => {
    const result = runRule(
      noTightDisplayTracking,
      `const Content = () => <><h1 className="tracking-tight">Build your next idea</h1><span className="tracking-tighter">v1.2</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine a responsive tracking variant with the base style", () => {
    const result = runRule(
      noTightDisplayTracking,
      `const Hero = () => <h2 className="tracking-normal md:tracking-tighter">Responsive heading</h2>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
