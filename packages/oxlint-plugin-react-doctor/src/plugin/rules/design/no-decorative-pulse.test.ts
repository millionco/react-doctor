import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativePulse } from "./no-decorative-pulse.js";

describe("no-decorative-pulse", () => {
  it("flags pulsing stable copy", () => {
    const result = runRule(
      noDecorativePulse,
      `const Hero = () => <span className="animate-pulse text-purple-500">New feature</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows loading and live status feedback", () => {
    const result = runRule(
      noDecorativePulse,
      `const Loading = () => <><div aria-busy="true" className="animate-pulse">Loading account</div><span role="status" className="animate-pulse">Syncing</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an empty status dot", () => {
    const result = runRule(
      noDecorativePulse,
      `const Status = () => <span aria-label="Online" className="size-2 rounded-full bg-green-500 animate-pulse" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat unrelated roles or aria-busy false as loading state", () => {
    const result = runRule(
      noDecorativePulse,
      `const Hero = () => <><button role="button" className="animate-pulse">New feature</button><span aria-busy="false" className="animate-pulse">New feature</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });
});
