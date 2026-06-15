import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { authTokenInWebStorage } from "./auth-token-in-web-storage.js";

describe("auth-token-in-web-storage", () => {
  it('flags `localStorage.setItem("authToken", t)`', () => {
    const result = runRule(authTokenInWebStorage, `localStorage.setItem("authToken", token);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("XSS");
  });

  it('flags `sessionStorage.setItem("jwt", x)`', () => {
    const result = runRule(authTokenInWebStorage, `sessionStorage.setItem("jwt", x);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `window.localStorage.setItem("refresh_token", x)`', () => {
    const result = runRule(
      authTokenInWebStorage,
      `window.localStorage.setItem("refresh_token", x);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `localStorage.accessToken = t` (property assignment)", () => {
    const result = runRule(authTokenInWebStorage, `localStorage.accessToken = t;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `localStorage["password"] = p` (computed assignment)', () => {
    const result = runRule(authTokenInWebStorage, `localStorage["password"] = p;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('does not flag a non-sensitive key (`"theme"`)', () => {
    const result = runRule(authTokenInWebStorage, `localStorage.setItem("theme", "dark");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic key", () => {
    const result = runRule(authTokenInWebStorage, `localStorage.setItem(key, token);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads (`getItem`)", () => {
    const result = runRule(authTokenInWebStorage, `const t = localStorage.getItem("token");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-web-storage object with the same shape", () => {
    const result = runRule(authTokenInWebStorage, `myStore.setItem("token", t);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reading a token property (not an assignment)", () => {
    const result = runRule(authTokenInWebStorage, `const t = localStorage.token;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
