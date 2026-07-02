import { defineRule } from "../../utils/define-rule.js";
import { isConfigOrCiPath } from "./utils/is-config-or-ci-path.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const clickjackingRedirectRisk = defineRule({
  id: "clickjacking-redirect-risk",
  title: "Redirect or frame boundary risk",
  severity: "warn",
  recommendation:
    "Allowlist redirect origins/paths, set `frame-ancestors` for privileged pages, and avoid URL-prefilled privileged dialogs.",
  // `[^)'"\n]*` keeps redirect keywords inside string literals
  // (`redirect('/login?message=...continue...')`) from counting — only a bare
  // identifier/property between `redirect(` and the keyword is caller input.
  // `(?!\s*(?:await\s+)?[\w$]*(?:safe|valid|sanitiz|allowlist|whitelist)`
  // skips targets already passed through a safe-redirect helper.
  // The iframe branch requires URL-param shapes (`redirect=`, query-style
  // `role=` — `[?&]role=`, including the `&amp;`-escaped form), not the bare
  // word `redirect` or an ARIA `role="..."` attribute — the 700-char window
  // bleeds past the tag, so a bare `role=` matched the accessible-iframe /
  // iframe-inside-a-modal idioms.
  scan: scanByPattern({
    shouldScan: (file) =>
      isProductionSourcePath(file.relativePath) || isConfigOrCiPath(file.relativePath),
    pattern:
      /\bredirect\s*\((?!\s*(?:await\s+)?[\w$]*(?:safe|valid|sanitiz|allowlist|whitelist)[\w$]*\s*\()[^)'"`\n]*\b(?:searchParams\.get|nextUrl\.searchParams|returnTo|callbackUrl|continue|next)\b|<iframe\b[\s\S]{0,700}(?:\b(?:next=|continue=|redirect=|redirect_uri|userstoinvite|sharingaction|\.\.)|[?&](?:amp;)?role=)|frame-ancestors\s+(?:\*|'self'\s+\*)|X-Frame-Options["']?\s*:\s*["']?ALLOW/i,
    message:
      "Redirect or framing configuration may let attacker-controlled URLs chain into privileged UI or clickjacking.",
  }),
});
