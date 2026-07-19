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

  // Bugbot: a PUBLIC segment mid-name is not public-by-design — only a
  // leading framework public prefix or a publishable/anon key convention is.
  it("flags a mid-name PUBLIC segment with a secret fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/webhooks.ts",
      content: `const s = process.env.INTERNAL_PUBLIC_WEBHOOK_SECRET ?? "whsec_realvalue123456";\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a public-prefixed name that still ends in _SECRET", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/webhooks.ts",
      content: `const s = process.env.NEXT_PUBLIC_WEBHOOK_SECRET ?? "whsec_abc123def456";\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a NEXT_PUBLIC_* URL fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/api.ts",
      content: `const u = process.env.NEXT_PUBLIC_API_URL ?? "https://api.example.com";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a SUPABASE_ANON_KEY fallback (client-safe by convention)", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/supabase.ts",
      content: `const k = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiJ9.anonpayload";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  // Docs-validation FP wave: a snake_case literal that ENDS in a secret word
  // is a name-like dummy placeholder, not a committed credential.
  it("stays silent on a name-like snake_case placeholder fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/cordova-util.js",
      content: `const t = process.env.REACT_APP_FACEBOOK_CLIENT_TOKEN || 'cboard_client_token';\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a zero-filled placeholder key fallback", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/tts.ts",
      content: `const k = process.env.ELEVENLABS_API_KEY || 'sk_0000000000000000000';\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on the public Anvil test mnemonic", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "packages/builder/fixtures.ts",
      content: `const privateKey = process.env.TEST_PRIVATE_KEY ?? "test test test test test test test test test test test junk";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a non-placeholder test private key", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "packages/builder/fixtures.ts",
      content: `const privateKey = process.env.TEST_PRIVATE_KEY ?? "0x9f2c1ab7e3d445219f2c1ab7e3d44521";\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent in a Playwright test-runner config file", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "playwright.config.ts",
      content: `const password = process.env.TEST_USER_PASSWORD || 'lote10mza126';\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a real secret fallback that merely contains a keyword mid-string", () => {
    const findings = runScanRule(secretInFallback, {
      relativePath: "src/lib/auth.ts",
      content: `const s = process.env.JWT_SIGNING_KEY ?? "hs256_key_9f2c1ab7e3d44521";\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
