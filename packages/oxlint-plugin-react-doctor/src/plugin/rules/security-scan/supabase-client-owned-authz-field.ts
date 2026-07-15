import { defineRule } from "../../utils/define-rule.js";
import { hasUseServerDirectiveInContent } from "./utils/has-use-server-directive-in-content.js";
import { isClientSourcePath } from "./utils/is-client-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const SENSITIVE_AUTH_FIELD_PATTERN =
  /\b(?:ownerId|ownerID|creatorId|creatorID|userId|userID|uid|providerId|providerID|orgId|orgID|tenantId|tenantID|teamId|teamID|workspaceId|workspaceID|ghostOrg|role|roles|isAdmin|admin)\b/;

const SUPABASE_CLIENT_AUTHZ_WRITE_PATTERN =
  /\b(?:supabase\b|\.from\s*\(\s*["'][^"']+["']\s*\))[\s\S]{0,700}\b(?:insert|upsert|update)\s*\(\s*(?:\{|\[?\s*\{)[\s\S]{0,700}\b(?:ownerId|creatorId|userId|orgId|tenantId|role|isAdmin)\b/i;

const scanSupabaseClientOwnedAuthzField = scanByPattern({
  shouldScan: (file) => isClientSourcePath(file.relativePath),
  pattern: SENSITIVE_AUTH_FIELD_PATTERN,
  requireAll: [SUPABASE_CLIENT_AUTHZ_WRITE_PATTERN],
  message:
    "Client Supabase code appears to write user, tenant, owner, or role fields that should be enforced by RLS.",
});

export const supabaseClientOwnedAuthzField = defineRule({
  id: "supabase-client-owned-authz-field",
  title: "Client writes Supabase authorization field",
  severity: "error",
  recommendation:
    "Use RLS policies based on `auth.uid()` and server-owned membership rows; do not trust client-provided owner, org, or role columns.",
  scan: (file) => {
    const findings = scanSupabaseClientOwnedAuthzField(file);
    if (findings.length === 0) return findings;
    return hasUseServerDirectiveInContent(file.content, file.relativePath) ? [] : findings;
  },
});
