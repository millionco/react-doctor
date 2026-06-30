import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { packageMetadataSecret } from "./package-metadata-secret.js";

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
});
