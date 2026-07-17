// rule: supabase-client-owned-authz-field
// weakness: framework-gating
// source: issue #1312 exact semicolonless server-action report

// prettier-ignore
"use server"

import { createClient } from "@/lib/supabase/server";

export const createFaqItem = async (tenantId: string, formData: FormData) => {
  const supabase = await createClient();
  await supabase.from("faq_items").insert({
    tenant_id: tenantId,
    question: String(formData.get("question")),
  });
};
