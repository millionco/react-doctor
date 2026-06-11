import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { publicEnvSecretName } from "./public-env-secret-name.js";

describe("security-scan/public-env-secret-name — regressions", () => {
  it("flags a secret-named public env variable", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "src/lib/identity.ts",
      content: `export const pylonSecret = import.meta.env.VITE_PYLON_IDENTITY_SECRET;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on publishable posthog tokens", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "src/lib/analytics.ts",
      content: `const posthog = new PostHog(process.env.VITE_PUBLIC_POSTHOG_TOKEN!, { host: "https://us.posthog.com" });\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on snippets under a docs tree", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "docs/onboarding/feature-flags/react-router.tsx",
      content: `const client = createClient(process.env.VITE_PUBLIC_LICENSE_SECRET);\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
