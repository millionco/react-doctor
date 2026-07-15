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

  it("stays silent on the exact semicolonless server-action report", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "app/(admin)/faq/actions.ts",
      content: `'use server'

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

  it("stays silent on a pinned semicolonless OSS server action", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "app/actions/token-trading-actions.ts",
      content: `"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function createBuyOffer(formData: { userId: string; poolId: string }) {
  const supabase = await createServerSupabaseClient();
  await supabase.from("token_offers").insert({
    buyer_id: formData.userId,
    pool_id: formData.poolId,
  });
}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when a multiline license precedes a real directive", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "src/actions/create-team.ts",
      content: `/**
 * Copyright Example Corp.
 */
'use server'

export async function createTeam(ownerId: string) {
  await supabase.from("teams").insert({ ownerId, role: "admin" });
}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a client write when 'use server' only appears in a block comment", () => {
    const findings = runScanRule(supabaseClientOwnedAuthzField, {
      relativePath: "src/lib/create-team.ts",
      content: `/*
'use server';
*/
export const createTeam = async (ownerId: string) => {
  await supabase.from("teams").insert({ ownerId, role: "admin" });
};`,
    });
    expect(findings).toHaveLength(1);
  });
});
