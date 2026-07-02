import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { packageMetadataSecret } from "./package-metadata-secret.js";

const SUPABASE_SERVICE_ROLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE2NDF9.M2NzY4NDU3NjQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEy";

describe("security-scan/package-metadata-secret — regressions", () => {
  // FP wave 4: the bare word `service_role` (a Supabase role name) in a
  // helper package's metadata is not a leaked secret value.
  it("stays silent on the word service_role in package metadata", () => {
    const findings = runScanRule(packageMetadataSecret, {
      relativePath: "package.json",
      content: `{"name":"supabase-service-role-helpers","description":"Utilities for the Supabase service_role key on the server.","keywords":["supabase","service_role","rls"]}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a real high-entropy secret value in package metadata", () => {
    const findings = runScanRule(packageMetadataSecret, {
      relativePath: "package.json",
      content: `{"name":"x","config":{"db":"postgres://dbuser:r3alL0ngPwd0rdValue@db.prod.example.com/app"}}`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  // FN wave (PR #993): dropping the bare `service_role` keyword must not
  // drop the *credential* — a service_role JWT value is caught by
  // JWT_LITERAL_VALUE_PATTERN.
  it("flags a leaked service_role JWT credential in package.json config", () => {
    const findings = runScanRule(packageMetadataSecret, {
      relativePath: "package.json",
      content: `{"name":"x","config":{"service_role":"${SUPABASE_SERVICE_ROLE_JWT}"}}`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("flags SUPABASE_SERVICE_ROLE_KEY name with JWT value in package.json", () => {
    const findings = runScanRule(packageMetadataSecret, {
      relativePath: "package.json",
      content: `{"name":"x","config":{"SUPABASE_SERVICE_ROLE_KEY":"${SUPABASE_SERVICE_ROLE_JWT}"}}`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("still fires on sb_secret_ style new-format supabase secret", () => {
    const findings = runScanRule(packageMetadataSecret, {
      relativePath: "package.json",
      content: `{"name":"x","config":{"key":"sb_secret_abcdefghijklmnopqrstuvwx"}}`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
