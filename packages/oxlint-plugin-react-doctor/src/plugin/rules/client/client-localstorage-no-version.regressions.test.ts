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
