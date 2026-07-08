import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { artifactSecretLeak } from "./artifact-secret-leak.js";

// Assembled at runtime so the canonical Stripe example key never appears
// as a contiguous literal — GitHub push protection rejects the raw token.
const stripeLiveSecretKey = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");

describe("security-scan/artifact-secret-leak — regressions", () => {
  it("flags a secret-looking credential value inside a browser artifact", () => {
    const findings = runScanRule(artifactSecretLeak, {
      relativePath: "dist/assets/index-abc123.js",
      content: `const stripe = Stripe("${stripeLiveSecretKey}");`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(
      "A browser-delivered artifact contains a secret-looking credential value.",
    );
  });

  it("stays silent on the same secret outside a browser-artifact path", () => {
    const findings = runScanRule(artifactSecretLeak, {
      relativePath: "server/billing/stripe.ts",
      content: `const stripe = Stripe("${stripeLiveSecretKey}");`,
    });
    expect(findings).toHaveLength(0);
  });
});
