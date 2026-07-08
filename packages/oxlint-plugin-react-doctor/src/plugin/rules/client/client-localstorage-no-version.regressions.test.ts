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
