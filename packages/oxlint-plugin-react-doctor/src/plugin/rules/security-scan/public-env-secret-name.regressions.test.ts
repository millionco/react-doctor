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

  // Docs-validation FP wave: test tooling under a `specs/` directory reads
  // VITE_-prefixed vars via process.env in Node — never bundled to the client.
  it("stays silent on test tooling under a specs/ directory", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "packages/react-components/specs/utils/getToken.ts",
      content: `const password = process.env["VITE_TEST_PASSWORD"] ?? "";\n`,
    });
    expect(findings).toHaveLength(0);
  });

  // vite.config.ts runs in Node at build time via loadEnv; nothing there is
  // inlined into the browser bundle.
  it("stays silent in a bundler config file", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "vite.config.ts",
      content: `const enableSentry = isBuild && !!env.VITE_SENTRY_AUTH_TOKEN;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  // Meta's FACEBOOK_CLIENT_TOKEN is a designated client-embeddable token —
  // the doc's FP case of a vendor publishable token not yet allowlisted.
  it("stays silent on Meta's client-embeddable FACEBOOK_CLIENT_TOKEN", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "src/cordova-util.js",
      content: `const t = process.env.REACT_APP_FACEBOOK_CLIENT_TOKEN || 'cboard_client_token';\n`,
    });
    expect(findings).toHaveLength(0);
  });

  // `*_TOKEN_KIND` names token-type metadata (a kind label), not a secret.
  it("stays silent on token metadata names like *_TOKEN_KIND", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "src/lib/oauth.ts",
      content: `const kind = import.meta.env.VITE_DEFAULT_OAUTH_TOKEN_KIND;\nconst url = import.meta.env.VITE_DEFAULT_OAUTH_TOKEN_URL;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a secret-named public env variable in client source", () => {
    const findings = runScanRule(publicEnvSecretName, {
      relativePath: "src/lib/db.ts",
      content: `const url = import.meta.env.VITE_DATABASE_URL;\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
