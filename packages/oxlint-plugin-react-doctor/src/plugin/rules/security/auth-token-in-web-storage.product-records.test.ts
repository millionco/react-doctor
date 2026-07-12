import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { authTokenInWebStorage } from "./auth-token-in-web-storage.js";

describe("auth-token-in-web-storage — product API-key records", () => {
  it("accepts qualified product API-key record collections", () => {
    const result = runRule(
      authTokenInWebStorage,
      `sessionStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still rejects actual API-key credential storage", () => {
    const result = runRule(authTokenInWebStorage, `localStorage.setItem("auth.apiKey", apiKey);`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
