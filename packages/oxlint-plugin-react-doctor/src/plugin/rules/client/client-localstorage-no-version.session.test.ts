import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientLocalstorageNoVersion } from "./client-localstorage-no-version.js";

describe("client-localstorage-no-version — session storage", () => {
  it("accepts unversioned session-scoped JSON", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `sessionStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports unversioned persistent localStorage JSON", () => {
    const result = runRule(
      clientLocalstorageNoVersion,
      `localStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
