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

  it("stays silent on files with 'use server' directive", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "app/(admin)/faq/actions.ts",
      content: `"use server";

import { createClient } from "@/lib/supabase/server";
import { requireTenantRole } from "@/lib/auth/require-role";

export async function createFaqItem(tenantId: string, formData: FormData) {
  const auth = await requireTenantRole(tenantId, "admin");
  if ("error" in auth) return { error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase.from("faq_items").insert({
    tenant_id: tenantId,
    question: String(formData.get("question")),
  });
  return error ? { error: error.message } : {};
}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on files with single-quoted 'use server' directive", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "src/actions/delete-post.ts",
      content: `'use server';

export async function deletePost(userId: string, postId: string) {
  await supabase.from("posts").delete().match({ id: postId, ownerId: userId });
}`,
    });
    expect(findings).toHaveLength(0);
  });
});
