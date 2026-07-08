import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { supabaseClientOwnedAuthzField } from "./supabase-client-owned-authz-field.js";

describe("security-scan/supabase-client-owned-authz-field — regressions", () => {
  it("flags client Supabase code inserting owner and role fields", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "src/lib/create-team.ts",
      content: `export const createTeam = async (name: string) => {
  await supabase.from("teams").insert({ name, ownerId: currentUser.id, role: "admin" });
};`,
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.message).toBe(
      "Client Supabase code appears to write user, tenant, owner, or role fields that should be enforced by RLS.",
    );
  });

  it("stays silent on the same write in a server context path", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "src/server/create-team.ts",
      content: `export const createTeam = async (name: string) => {
  await supabase.from("teams").insert({ name, ownerId: currentUser.id, role: "admin" });
};`,
    });
    expect(findings).toHaveLength(0);
  });
});
