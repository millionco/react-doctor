import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { authTokenInWebStorage } from "./auth-token-in-web-storage.js";

describe("auth-token-in-web-storage — product API-key records", () => {
  it("rejects qualified product API-key record collections", () => {
    const result = runRule(
      authTokenInWebStorage,
      `sessionStorage.setItem("mailing.createdApiKeys", JSON.stringify(records));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still rejects actual API-key credential storage", () => {
    const result = runRule(authTokenInWebStorage, `localStorage.setItem("auth.apiKey", apiKey);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects product records whose opaque id is the usable credential", () => {
    const result = runRule(
      authTokenInWebStorage,
      `interface ApiKeyRow {
        id: string;
        active: boolean;
        createdAt: string;
      }
      const persistApiKeys = (records: ApiKeyRow[]) => {
        sessionStorage.setItem("mailing.settings.localApiKeys", JSON.stringify(records));
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
