import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSecretsInClientCode } from "./no-secrets-in-client-code.js";

const runClient = (code: string) =>
  runRule(noSecretsInClientCode, `"use client";\n${code}`, {
    filename: "src/components/config.tsx",
  }).diagnostics;

describe("security/no-secrets-in-client-code — regressions", () => {
  // FP wave 4: a public OAuth/authorize endpoint URL is meant to ship to the
  // browser, even when its variable name matches the secret-name heuristic.
  it("stays silent on a public OAuth endpoint URL named authEndpoint", () => {
    expect(
      runClient(`const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";`),
    ).toHaveLength(0);
  });

  // …but a URL that carries a credential in its query still flags.
  it("still flags a credentialed URL via the name heuristic", () => {
    expect(
      runClient(`const authEndpoint = "https://api.example.com/auth?token=supersecretvalue123";`)
        .length,
    ).toBeGreaterThan(0);
  });

  // FP-fix PR #993: a credential carried in a URL #fragment (OAuth implicit
  // flow) must defeat the public-URL exemption, not be exempted by it.
  it("flags a fragment-credential URL (OAuth implicit flow)", () => {
    expect(
      runClient(
        `const authEndpoint = "https://app.acmecorp.io/callback#access_token=ya29GxkQ83nfA71bQpz44";`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("flags a userinfo-credential URL", () => {
    expect(
      runClient(`const authEndpoint = "https://svcuser:qX9v3LmZk84TrWpB2@api.acmecorp.io/auth";`)
        .length,
    ).toBeGreaterThan(0);
  });

  // Fuzz FP hunt (corpus census 2026-07): `auth` matching inside
  // `author(s)` — a component identifier named
  // `TOP_PR_AUTHORS_..._IDENTIFIER` holding a UUID is not a credential.
  it("stays silent on author-named variables (auth inside author)", () => {
    expect(
      runClient(
        `export const TOP_PR_AUTHORS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER = "a1d4f7e2-9b3c-4e8a-bf21-5d6c8a9b2e3f";`,
      ),
    ).toHaveLength(0);
    expect(
      runClient(`export const coAuthorsListJson = "jane;john;maria;pedro;li;omar;zoe";`),
    ).toHaveLength(0);
  });

  // …while authorization/authorised (the credential words containing
  // "author") still match the name heuristic.
  it("still flags authorization/authorised-named values", () => {
    expect(
      runClient(`const authorizationValue = "Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0";`).length,
    ).toBeGreaterThan(0);
    expect(
      runClient(`const authorisedSigningValue = "9f8e7d6c5b4a39281706f5e4d3c2b1a0abcdef";`).length,
    ).toBeGreaterThan(0);
  });
});
