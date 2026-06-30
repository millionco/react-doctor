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
});
