import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientLocalstorageNoVersion } from "./client-localstorage-no-version.js";

describe("client/client-localstorage-no-version — regressions", () => {
  it("stays silent on a camelCase version suffix", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `localStorage.setItem("userPrefsV2", JSON.stringify(prefs));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an unversioned key", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `localStorage.setItem("userPrefs", JSON.stringify(prefs));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when every read validates the parsed payload and falls back safely", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "keybindings";
      const DEFAULT_KEY_BINDINGS = { next: "j", previous: "k" };
      const isValidKeybindings = (value) => {
        if (typeof value !== "object" || value === null) return false;
        const keybindings = value as Record<string, unknown>;
        return typeof keybindings.next === "string" &&
          typeof keybindings.previous === "string";
      };
      const getStoredKeybindings = () => {
        try {
          const rawValue = localStorage.getItem(STORAGE_KEY);
          if (!rawValue) return DEFAULT_KEY_BINDINGS;
          const parsedValue = JSON.parse(rawValue);
          return isValidKeybindings(parsedValue) ? parsedValue : DEFAULT_KEY_BINDINGS;
        } catch {
          return DEFAULT_KEY_BINDINGS;
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags readers that parse without validating the payload", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "preferences";
      const getStoredPreferences = () => {
        try {
          const rawValue = localStorage.getItem(STORAGE_KEY);
          return rawValue ? JSON.parse(rawValue) : {};
        } catch {
          return {};
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags validation without a parse-error fallback", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "preferences";
      const isValidPreferences = (value) => typeof value.name === "string";
      const rawValue = localStorage.getItem(STORAGE_KEY);
      const parsedValue = JSON.parse(rawValue);
      const preferences = isValidPreferences(parsedValue) ? parsedValue : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when validation does not guard the returned payload", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "preferences";
      const isValidPreferences = (value) => typeof value.name === "string";
      const getStoredPreferences = () => {
        try {
          const rawValue = localStorage.getItem(STORAGE_KEY);
          const parsedValue = JSON.parse(rawValue);
          isValidPreferences(parsedValue) ? parsedValue : {};
          return parsedValue;
        } catch {
          return {};
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when only a nested helper returns the validated payload", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "preferences";
      const isValidPreferences = (value) => typeof value.name === "string";
      const getStoredPreferences = () => {
        try {
          const rawValue = localStorage.getItem(STORAGE_KEY);
          const parsedValue = JSON.parse(rawValue);
          const getValidatedValue = () =>
            isValidPreferences(parsedValue) ? parsedValue : {};
          getValidatedValue();
          return parsedValue;
        } catch {
          return {};
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when another reader of the same key skips validation", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const STORAGE_KEY = "preferences";
      const isValidPreferences = (value) => typeof value.name === "string";
      const getSafePreferences = () => {
        try {
          const rawValue = localStorage.getItem(STORAGE_KEY);
          const parsedValue = JSON.parse(rawValue);
          return isValidPreferences(parsedValue) ? parsedValue : {};
        } catch {
          return {};
        }
      };
      const getUncheckedPreferences = () => JSON.parse(localStorage.getItem(STORAGE_KEY));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // Mined miss (glific orgEvalAccessCache): the key was a same-file string
  // constant, not an inline literal, so the Literal-only gate skipped it.
  it("flags a key held in a same-file const string (glific shape)", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `export const ORG_EVAL_ACCESS_CACHE_KEY = 'glific_org_eval_access_request';
      export const persist = (payload) => {
        localStorage.setItem(ORG_EVAL_ACCESS_CACHE_KEY, JSON.stringify(payload));
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the const key carries a version suffix", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `const CACHE_KEY = 'prefs:v2';
      localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the key binding is not a const string literal", () => {
    const letKey = runRule(
      clientLocalstorageNoVersion,
      `let key = 'prefs';
      key = computeKey();
      localStorage.setItem(key, JSON.stringify(prefs));`,
    );
    const dynamicKey = runRule(
      clientLocalstorageNoVersion,
      `const key = buildKey();
      localStorage.setItem(key, JSON.stringify(prefs));`,
    );
    expect(letKey.diagnostics).toEqual([]);
    expect(dynamicKey.diagnostics).toEqual([]);
  });

  it("still flags an unversioned key when the `localStorage` receiver is wrapped in `as any`", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `(localStorage as any).setItem("userPrefs", JSON.stringify(prefs));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on snake_case and colon version suffixes", () => {
    const snakeCase = runRule(
      clientLocalstorageNoVersion,
      `localStorage.setItem("prefs_v2", JSON.stringify(prefs));`,
    );
    const colon = runRule(
      clientLocalstorageNoVersion,
      `localStorage.setItem("userPrefs:v2", JSON.stringify(prefs));`,
    );
    expect(snakeCase.diagnostics).toEqual([]);
    expect(colon.diagnostics).toEqual([]);
  });
});
