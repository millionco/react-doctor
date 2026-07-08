import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { supabaseRlsPolicyRisk } from "./supabase-rls-policy-risk.js";

describe("security-scan/supabase-rls-policy-risk — regressions", () => {
  it("flags a permissive write-open policy in a supabase migration", () => {
    const findings = runScanRule(supabaseRlsPolicyRisk, {
      relativePath: "supabase/migrations/0001_init.sql",
      content: `create policy "open writes" on posts for all using (true);\n`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("stays silent on a permissive read-only policy", () => {
    const findings = runScanRule(supabaseRlsPolicyRisk, {
      relativePath: "supabase/migrations/0001_init.sql",
      content: `create policy "public read" on posts for select using (true);\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
