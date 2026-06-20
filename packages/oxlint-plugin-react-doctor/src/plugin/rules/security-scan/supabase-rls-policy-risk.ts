import { defineRule } from "../../utils/define-rule.js";
import { isSqlPath } from "./utils/is-sql-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const DISABLED_RLS_PATTERN = /(?<!if\s+exists\s+[\w.]+\s+)disable\s+row\s+level\s+security/i;

const SERVICE_ROLE_POLICY_PATTERN =
  /create\s+policy[\s\S]{0,700}auth\.role\(\)\s*=\s*["']service_role["']/i;

const OPEN_WRITE_POLICY_PATTERN =
  /create\s+policy[\s\S]{0,700}\bfor\s+(?:all|insert|update|delete)\b[\s\S]{0,500}(?<!\bto\s+(?:service_role|authenticated|anon_admin|postgres)\s+)\b(?:using|with\s+check)\s*\(\s*true\s*\)/i;

const IMPLICIT_OPEN_POLICY_PATTERN =
  /create\s+policy(?:(?!\bfor\s+select\b)[\s\S]){0,700}(?<!\bto\s+(?:service_role|authenticated|anon_admin|postgres)\s+)\b(?:using|with\s+check)\s*\(\s*true\s*\)/i;

export const supabaseRlsPolicyRisk = defineRule({
  id: "supabase-rls-policy-risk",
  title: "Permissive Supabase RLS policy",
  severity: "error",
  recommendation:
    "Keep public-read policies explicit, but gate inserts, updates, deletes, and service-role bypasses behind `auth.uid()` plus trusted tenant membership.",
  scan: scanByPattern({
    shouldScan: (file) => isSqlPath(file.relativePath),
    pattern: [
      DISABLED_RLS_PATTERN,
      SERVICE_ROLE_POLICY_PATTERN,
      OPEN_WRITE_POLICY_PATTERN,
      IMPLICIT_OPEN_POLICY_PATTERN,
    ],
    message:
      "Supabase policy SQL disables RLS, permits writes broadly, or references a service-role bypass.",
  }),
});
