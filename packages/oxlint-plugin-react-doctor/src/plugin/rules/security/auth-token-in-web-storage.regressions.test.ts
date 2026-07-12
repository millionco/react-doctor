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

  it("stays silent on product-scoped API-key table records", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const LOCAL_API_KEYS_STORAGE_KEY = "mailing.createdApiKeys";
      sessionStorage.setItem(
        LOCAL_API_KEYS_STORAGE_KEY,
        JSON.stringify([{ id, key, status, createdAt }]),
      );`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags authentication API keys and singular credentials", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `sessionStorage.setItem("auth.apiKey", apiKey);
      sessionStorage.setItem("mailing.createdApiKey", apiKey);`,
    );
    expect(diagnostics).toHaveLength(2);
  });

  // Docs-validation FP wave: E2E scaffolding under `playwright/` seeds tokens
  // via page.evaluate to simulate login — test tooling, not production
  // exposure. `/playwright/` was missing from the testlike path segments.
  it("stays silent in Playwright E2E support helpers", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem('af_auth_token', tokenData.access_token);\nlocalStorage.setItem('af_refresh_token', tokenData.refresh_token);\nlocalStorage.setItem('token', JSON.stringify(tokenData));`,
      { filename: "/repo/playwright/support/auth-utils.ts" },
    );
    expect(diagnostics).toEqual([]);
  });

  it("still flags the same writes in production source", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `localStorage.setItem('af_auth_token', tokenData.access_token);`,
      { filename: "/repo/src/services/session.ts" },
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // FN mining: key/receiver shapes equivalent to the canonical pattern.
  it("flags a substitution-free template-literal key", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      "localStorage.setItem(`accessToken`, token);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a template-literal key with substitutions (key not statically known)", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      "localStorage.setItem(`${namespace}:cache`, payload);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a key routed through a same-file const", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const TOKEN_STORAGE_KEY = "auth_token";
      export const persistToken = (token) => {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      };`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the const key is not credential-shaped", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const THEME_STORAGE_KEY = "theme";
      export const persistTheme = (theme) => {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      };`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags storage aliased to a local binding", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `export const persistToken = (token) => {
        const storage = window.localStorage;
        storage.setItem("jwt", token);
      };`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the aliased binding is not web storage", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `export const persistToken = (token) => {
        const storage = new MapStorage();
        storage.setItem("jwt", token);
      };`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
