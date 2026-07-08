import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { corsCookieTrustRisk } from "./cors-cookie-trust-risk.js";

describe("security-scan/cors-cookie-trust-risk — regressions", () => {
  it("flags Allow-Credentials true paired with a wildcard Allow-Origin", () => {
    const findings = runScanRule(corsCookieTrustRisk, {
      relativePath: "src/server/cors.ts",
      content: `res.setHeader("Access-Control-Allow-Credentials", "true");
res.setHeader("Access-Control-Allow-Origin", "*");
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags an auth cookie scoped to a parent domain via Set-Cookie", () => {
    const findings = runScanRule(corsCookieTrustRisk, {
      relativePath: "src/server/session.ts",
      content: `res.setHeader("Set-Cookie", "session=abc; Domain=.example.com; Path=/");
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a parent-domain auth cookie set via cookie options", () => {
    const findings = runScanRule(corsCookieTrustRisk, {
      relativePath: "src/server/session.ts",
      content: `res.cookie("auth", token, { domain: "Domain=.example.com" });
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a host-only session cookie", () => {
    const findings = runScanRule(corsCookieTrustRisk, {
      relativePath: "src/server/session.ts",
      content: `res.setHeader("Set-Cookie", "session=abc; Path=/; HttpOnly; Secure");
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on non-credentialed wildcard CORS", () => {
    const findings = runScanRule(corsCookieTrustRisk, {
      relativePath: "src/server/cors.ts",
      content: `res.setHeader("Access-Control-Allow-Origin", "*");
`,
    });
    expect(findings).toHaveLength(0);
  });
});
