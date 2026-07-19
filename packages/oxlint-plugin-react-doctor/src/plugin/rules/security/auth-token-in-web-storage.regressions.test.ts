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

  it("flags product-scoped API-key table records", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const LOCAL_API_KEYS_STORAGE_KEY = "mailing.createdApiKeys";
      sessionStorage.setItem(
        LOCAL_API_KEYS_STORAGE_KEY,
        JSON.stringify([{ id, key, status, createdAt }]),
      );`,
    );
    expect(diagnostics).toHaveLength(1);
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

  it("flags immutable storage alias chains", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const browserStorage = window.sessionStorage;
      const storage = browserStorage;
      storage.setItem("mailing.settings.localApiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags storage returned by a local factory", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const getSessionStorage = () => window.sessionStorage;
      const storage = getSessionStorage();
      storage.setItem("mailing.settings.apiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags guarded storage returned by a local factory", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `function getSessionStorage() {
        if (typeof window === "undefined") return null;
        try {
          return window.sessionStorage;
        } catch {
          return null;
        }
      }
      const storage = getSessionStorage();
      if (storage) storage.setItem("mailing.settings.apiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags credential keys and values forwarded through a local helper", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const writeStorage = (key, value) => {
        window.sessionStorage.setItem(key, value);
      };
      writeStorage("mailing.settings.localApiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags aliased helper parameters forwarded to web storage", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const writeStorage = (key, value) => {
        const storageKey = key;
        const serializedValue = value;
        sessionStorage.setItem(storageKey, serializedValue);
      };
      writeStorage("mailing.settings.localApiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags a helper whose receiver comes from a guarded storage factory", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `function getSessionStorage() {
        if (typeof window === "undefined") return null;
        return window.sessionStorage;
      }
      function writeStorage(key, value) {
        const storage = getSessionStorage();
        if (storage) storage.setItem(key, value);
      }
      writeStorage("mailing.settings.localApiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags storage factories and helpers through immutable alias chains", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const getSessionStorage = () => window.sessionStorage;
      const resolveStorage = getSessionStorage;
      const storageFactory = resolveStorage;
      const writeStorage = (key, value) => {
        storageFactory().setItem(key, value);
      };
      const persistCredential = writeStorage;
      const saveCredential = persistCredential;
      saveCredential("mailing.settings.localApiKeys", JSON.stringify(records));`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags conditional and logical guarded storage factory results", () => {
    const conditional = runRule(
      authTokenInWebStorage,
      `const getStorage = () =>
        typeof window === "undefined" ? void 0 : window.sessionStorage;
      const storage = getStorage();
      if (storage) storage.setItem("authToken", token);`,
    );
    const logical = runRule(
      authTokenInWebStorage,
      `const getStorage = () =>
        typeof window !== "undefined" && window.localStorage;
      const storage = getStorage();
      if (storage) storage.setItem("authToken", token);`,
    );

    expect(conditional.diagnostics).toHaveLength(1);
    expect(logical.diagnostics).toHaveLength(1);
  });

  it("flags a factory that falls back between web storage objects", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const getStorage = () => window.sessionStorage || window.localStorage;
      const storage = getStorage();
      storage.setItem("authToken", token);`,
    );

    expect(diagnostics).toHaveLength(1);
  });

  it("flags credential arguments for every storage sink in a helper", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `const persist = (cacheKey, cacheValue, credentialKey, credentialValue) => {
        localStorage.setItem(credentialKey, credentialValue);
        sessionStorage.setItem(cacheKey, cacheValue);
      };
      persist("theme", theme, "authToken", token);`,
    );

    expect(diagnostics).toHaveLength(1);
  });

  it("flags credential arguments forwarded through default parameters", () => {
    const { diagnostics, parseErrors } = runRule(
      authTokenInWebStorage,
      `const persist = (key = "cache", value = "") => {
        localStorage.setItem(key, value);
      };
      persist("authToken", token);`,
    );

    expect(parseErrors).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("flags credential arguments passed to a TypeScript-wrapped helper", () => {
    const { diagnostics, parseErrors } = runRule(
      authTokenInWebStorage,
      `const persist = (key: string, value: string) => {
        sessionStorage.setItem(key, value);
      };
      (persist as (key: string, value: string) => void)("accessToken", token);`,
      { filename: "storage.ts" },
    );

    expect(parseErrors).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("flags typed helper parameters serialized through TypeScript wrappers", () => {
    const { diagnostics, parseErrors } = runRule(
      authTokenInWebStorage,
      `interface CredentialRecord { token: string }
      const persist = (key: string, value: CredentialRecord | null) => {
        sessionStorage.setItem(key, JSON.stringify((value as CredentialRecord)!));
      };
      persist("accessToken", credential);`,
      { filename: "storage.ts" },
    );

    expect(parseErrors).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("flags runtime arguments after a TypeScript this parameter", () => {
    const { diagnostics, parseErrors } = runRule(
      authTokenInWebStorage,
      `function persist(this: void, key: string, value: string) {
        sessionStorage.setItem(key, value);
      }
      persist("accessToken", token);`,
      { filename: "storage.ts" },
    );

    expect(parseErrors).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("stays silent when a helper-local key shadows its parameter", () => {
    const { diagnostics, parseErrors } = runRule(
      authTokenInWebStorage,
      `const persist = (key, value) => {
        {
          const key = "theme";
          localStorage.setItem(key, value);
        }
      };
      persist("authToken", token);`,
    );

    expect(parseErrors).toEqual([]);
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a storage factory with a void nullish return branch", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `function getStorage() {
        if (typeof window === "undefined") return void 0;
        return window.sessionStorage;
      }
      const storage = getStorage();
      if (storage) storage.setItem("authToken", token);`,
    );

    expect(diagnostics).toHaveLength(1);
  });

  it("stays silent for mutable receiver aliases and unrelated helper sinks", () => {
    const { diagnostics } = runRule(
      authTokenInWebStorage,
      `let storage = sessionStorage;
      storage = customStorage;
      storage.setItem("authToken", token);
      const writeStorage = (key, value) => customStorage.setItem(key, value);
      writeStorage("authToken", token);`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
