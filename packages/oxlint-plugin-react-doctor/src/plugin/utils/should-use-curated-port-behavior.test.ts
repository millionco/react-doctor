import { describe, expect, it } from "vite-plus/test";
import { shouldUseCuratedPortBehavior } from "./should-use-curated-port-behavior.js";

describe("shouldUseCuratedPortBehavior", () => {
  it("defaults direct plugin consumers to upstream behavior", () => {
    expect(shouldUseCuratedPortBehavior(undefined)).toBe(false);
    expect(shouldUseCuratedPortBehavior({ "react-doctor": {} })).toBe(false);
  });

  it("enables curated behavior only when explicitly configured", () => {
    expect(
      shouldUseCuratedPortBehavior({
        "react-doctor": { portedRuleMode: "curated" },
      }),
    ).toBe(true);
  });
});
