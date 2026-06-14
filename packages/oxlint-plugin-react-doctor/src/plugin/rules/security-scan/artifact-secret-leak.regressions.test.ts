import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { artifactSecretLeak } from "./artifact-secret-leak.js";

describe("security-scan/artifact-secret-leak — regressions", () => {
  it("flags a private-key marker shipped in a browser artifact", () => {
    const findings = runScanRule(artifactSecretLeak, {
      relativePath: ".next/static/chunks/leaked.js",
      content: `const key = "-----BEGIN PRIVATE KEY-----";`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on PEM markers in Next.js dev server source maps", () => {
    const findings = runScanRule(artifactSecretLeak, {
      relativePath: ".next/dev/server/chunks/[root-of-the-server]__node-rsa.js.map",
      content: `{"sourcesContent":["const pem = '-----BEGIN RSA PRIVATE KEY-----';"]}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on PEM markers in production .next/server source maps", () => {
    const findings = runScanRule(artifactSecretLeak, {
      relativePath: ".next/server/app/api/route.js.map",
      content: `{"sourcesContent":["const pem = '-----BEGIN PRIVATE KEY-----';"]}`,
    });
    expect(findings).toHaveLength(0);
  });
});
