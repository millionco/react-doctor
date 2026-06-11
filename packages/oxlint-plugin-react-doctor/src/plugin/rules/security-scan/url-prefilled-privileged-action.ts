import { defineRule } from "../../utils/define-rule.js";
import { isClientSourcePath } from "./utils/is-client-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// The privileged name must be the parameter actually read — a proximity
// window matches `from "next/..."` imports and any file mentioning users.
// No `email`/`user`: prefilled emails and username route params are benign
// booking/contact UX, not privileged actions. The lookbehind skips reads
// already wrapped in a validating helper (`getRelativeNextPath(...get("next"))`).
const PRIVILEGED_QUERY_PARAM_PATTERN =
  /(?<!(?:safe|valid|sanitiz|relativ|allowlist|whitelist)[\w$]*\(\s*(?:new\s+)?)\b(?:searchParams|useSearchParams\s*\(\s*\)|URLSearchParams\s*\([^)]{0,120}\))(?:[?!])?\.get(?:All)?\s*\(\s*["'](?:userstoinvite|role|permission|sharingaction|invite|admin|next|continue|returnTo|redirect_uri|callbackUrl)["']|\bsearchParams\.(?:userstoinvite|role|permission|sharingaction|invite|admin|returnTo|redirect_uri|callbackUrl)\b/i;

export const urlPrefilledPrivilegedAction = defineRule({
  id: "url-prefilled-privileged-action",
  title: "URL pre-fills a privileged action",
  severity: "warn",
  recommendation:
    "Require server-side validation and explicit confirmation for URL-sourced invite, role, permission, redirect, or sharing parameters.",
  scan: scanByPattern({
    shouldScan: (file) => isClientSourcePath(file.relativePath),
    pattern: PRIVILEGED_QUERY_PARAM_PATTERN,
    message:
      "Client code reads sensitive action state from the URL, which can pre-fill invites, roles, redirects, or sharing flows with attacker values.",
  }),
});
