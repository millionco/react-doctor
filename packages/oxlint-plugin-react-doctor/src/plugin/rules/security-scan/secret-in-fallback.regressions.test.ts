import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { secretInFallback } from "./secret-in-fallback.js";

describe("security-scan/secret-in-fallback — regressions", () => {
  it("stays silent on NEXT_PUBLIC_* tokens (public-by-design, inlined into the bundle)", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/map.ts",
      content: `const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "pk.eyJ1IjoiZXhhbXBsZSJ9";\nconst key = process.env.NEXT_PUBLIC_API_KEY ?? "abcdef123456";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a *_PUBLISHABLE_KEY mid-name keyword", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/stripe.ts",
      content: `const k = process.env.STRIPE_PUBLISHABLE_KEY ?? "pk_test_abcdef123456";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a genuine secret env var with a hardcoded fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/stripe.ts",
      content: `const k = process.env.STRIPE_SECRET_KEY ?? "sk_live_abcdef123456";\n`,
    });
    expect(findings).toHaveLength(1);
  });

  // FP wave 4: a purely numeric default is a duration/size config, never a
  // credential — even when the env name carries `TOKEN`/`SECRET`.
  it("stays silent on a numeric duration fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/config.ts",
      content: `const t = process.env.SESSION_TOKEN_TIMEOUT ?? "18000000";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a non-numeric secret fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/config.ts",
      content: `const k = process.env.STRIPE_SECRET_KEY ?? "sk_live_realsecretvalue12345";\n`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
