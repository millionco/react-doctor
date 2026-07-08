import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { jwtInsecureVerification } from "./jwt-insecure-verification.js";

describe("security-scan/jwt-insecure-verification — regressions", () => {
  it("flags jwt.verify configured with the none algorithm", () => {
    const findings = runScanRule(jwtInsecureVerification, {
      relativePath: "src/server/auth.ts",
      content: `import jwt from "jsonwebtoken";\nconst payload = jwt.verify(token, secret, { algorithms: ["none"] });\n`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("stays silent when the none algorithm only appears in an error string", () => {
    const findings = runScanRule(jwtInsecureVerification, {
      relativePath: "src/server/auth.ts",
      content: `import jwt from "jsonwebtoken";\nconst warning = "never configure algorithms: 'none' in production";\nconst payload = jwt.verify(token, secret, { algorithms: ["RS256"] });\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
