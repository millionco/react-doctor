import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { insecureSessionCookie } from "./insecure-session-cookie.js";

describe("security-scan/insecure-session-cookie — regressions", () => {
  it("flags res.cookie of a session token with httpOnly disabled", () => {
    const findings = runScanRule(insecureSessionCookie, {
      relativePath: "src/server/session.ts",
      content: `res.cookie("session_token", token, { httpOnly: false, secure: false });
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags an auth cookie set with no options object at all", () => {
    const findings = runScanRule(insecureSessionCookie, {
      relativePath: "src/server/login.ts",
      content: `res.cookie("auth", token);
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a session-middleware cookie block disabling httpOnly", () => {
    const findings = runScanRule(insecureSessionCookie, {
      relativePath: "src/server/app.ts",
      content: `app.use(session({ secret, cookie: { httpOnly: false, maxAge: 60000 } }));
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags an auth cookie written through document.cookie", () => {
    const findings = runScanRule(insecureSessionCookie, {
      relativePath: "src/lib/auth.ts",
      content: `document.cookie = \`access_token=\${token}; path=/\`;
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a secure HttpOnly session cookie", () => {
    const findings = runScanRule(insecureSessionCookie, {
      relativePath: "src/server/session.ts",
      content: `res.cookie("session", token, { httpOnly: true, secure: true, sameSite: "lax" });
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a JS-readable non-auth cookie", () => {
    const findings = runScanRule(insecureSessionCookie, {
      relativePath: "src/lib/theme.ts",
      content: `document.cookie = "theme=dark; path=/";
`,
    });
    expect(findings).toHaveLength(0);
  });
});
