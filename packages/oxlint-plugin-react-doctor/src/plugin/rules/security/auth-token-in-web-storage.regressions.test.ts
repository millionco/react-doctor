import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { authTokenInWebStorage } from "./auth-token-in-web-storage.js";

describe("security/auth-token-in-web-storage — regressions", () => {
  it("stays silent on CSRF tokens (intentionally JS-readable double-submit)", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem("csrf-token", csrfToken);\nlocalStorage["xsrfToken"] = t;`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on FCM/APNs/push device tokens (routing identifiers, not secrets)", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem("fcmDeviceToken", deviceToken);\nlocalStorage.setItem("pushToken", p);`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags genuine auth tokens", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem("authToken", t);\nsessionStorage.setItem("accessToken", a);`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a device-scoped value that also carries a strong auth signal", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem("deviceAccessToken", t);`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // FP wave 4: design tokens / tokenizer / syntax-highlighting configs are
  // styling data, not credentials, even though the key contains `token`.
  it("stays silent on design tokens and tokenizer config", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem("designTokens", JSON.stringify(theme));\nlocalStorage.setItem("tokenizerConfig", JSON.stringify(opts));`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a real auth token alongside design tokens", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem("designTokens", JSON.stringify(theme));\nlocalStorage.setItem("authToken", t);`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
