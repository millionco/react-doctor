import { getClassifiedWebhookEntrypoint } from "./utils/get-classified-webhook-entrypoint.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { WEBHOOK_EMPTY_FINDING_COUNT } from "./utils/webhook-entrypoint/constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import { hasCanonicalShopifyWebhookGate } from "./utils/has-canonical-shopify-webhook-gate.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const WEBHOOK_HANDLER_PATTERN =
  /(?:^|\/)[^/]*webhook[^/]*\/|(?:^|\/)[^/]*webhook[^/]*\.[cm]?[jt]s$|\bwebhook\b/i;

const WEBHOOK_ENTRYPOINT_PATTERN =
  /\b(?:export\s+(?:async\s+)?function\s+POST|export\s+const\s+(?:POST|handler|webhook)|webhookHandler|webhookRoute)\b/i;

// In-file verification evidence: a known SDK call, a timing-safe comparison, a
// provider helper, or a read of a `*-signature` header/config name.
const WEBHOOK_VERIFICATION_SIGNAL_PATTERN =
  /verifySignature|verify.*signature|verify\w*(?:Webhook|Auth)|constructEvent|createHmac|timingSafeEqual|svix|webhookSecret|stripe\.webhooks|["'][\w-]*signature["']/;

// A call to a verification helper whose name pairs a verify-ish verb with a
// webhook-security noun (`isValidSecret(...)`, `verifySignature(...)`,
// `checkWebhookHmac(...)`), so an extracted timing-safe comparison in another
// module still counts. `token` is deliberately excluded from the nouns — a
// generic `validateToken(…)` auth check is not signature verification (the
// `webhook` noun still covers `verifyWebhookToken`). The letter runs around the
// verb/noun are length-bounded (not `[A-Za-z]*`) so a long identifier-like run
// cannot cause catastrophic regex backtracking.
const WEBHOOK_VERIFICATION_HELPER_CALL_PATTERN =
  /\b[A-Za-z]{0,40}(?:verif|valid|check|assert|authenticat|compare|guard)[A-Za-z]{0,40}(?:secret|signature|hmac|webhook|digest)[A-Za-z]{0,40}\s*\(/;

// Either kind of evidence suppresses the finding (composed case-insensitively
// from the two readable sub-patterns above).
const WEBHOOK_SIGNATURE_VERIFICATION_PATTERN = new RegExp(
  `${WEBHOOK_VERIFICATION_SIGNAL_PATTERN.source}|${WEBHOOK_VERIFICATION_HELPER_CALL_PATTERN.source}`,
  "i",
);

// `webhookUrl` mentions mark code SENDING to a webhook (outbound), where
// signature verification is the receiver's job, not this file's. A webhook
// URL read from the file's own env or a `sendToDiscordWebhook(...)` call is
// likewise an outbound destination.
const OUTBOUND_WEBHOOK_URL_MENTION_PATTERN = /webhook[\s_-]?ur[il]\w*/gi;

const OUTBOUND_WEBHOOK_CONFIG_PATTERN =
  /process\.env\.\w*WEBHOOK_URL|\b(?:send|post|dispatch|publish|notify)\w*Webhook/;

// `export const POST = stripeWebhookHandler;` re-exports a handler defined
// elsewhere — there is no body in this file to judge for verification.
const REQUEST_READ_PATTERN = /\b(?:req|request)\b/;

// "webhook" appearing only in comments or string literals (retry-behavior
// notes, prompt text) does not make the file a webhook handler.
const COMMENT_OR_STRING_PATTERN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;

const scanWebhookEntrypoints = scanByPattern({
  shouldScan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return false;
    if (OUTBOUND_WEBHOOK_CONFIG_PATTERN.test(file.content)) return false;
    const judgeableContent = file.content
      .replace(COMMENT_OR_STRING_PATTERN, "")
      .replace(OUTBOUND_WEBHOOK_URL_MENTION_PATTERN, "");
    return (
      WEBHOOK_HANDLER_PATTERN.test(file.relativePath) ||
      WEBHOOK_HANDLER_PATTERN.test(judgeableContent)
    );
  },
  pattern: WEBHOOK_ENTRYPOINT_PATTERN,
  requireAll: [REQUEST_READ_PATTERN],
  suppressWhen: WEBHOOK_SIGNATURE_VERIFICATION_PATTERN,
  message: "Webhook handler code does not show an obvious signature verification step.",
});

export const webhookSignatureRisk = defineRule({
  id: "webhook-signature-risk",
  title: "Webhook handler lacks signature verification",
  severity: "warn",
  recommendation:
    "Verify provider signatures before parsing or acting on webhook bodies. Use provider SDK helpers or HMAC verification with timing-safe comparison.",
  scan: (file) => {
    const findings = scanWebhookEntrypoints(file);
    if (findings.length === WEBHOOK_EMPTY_FINDING_COUNT) return findings;
    let parsedProgram: EsTreeNode | null | undefined;
    const readProgram = (): EsTreeNode | null => {
      if (parsedProgram === undefined) {
        try {
          parsedProgram = parseSourceText({
            filename: file.absolutePath,
            sourceText: file.content,
            shouldAttachParentReferences: false,
          });
        } catch {
          parsedProgram = null;
        }
      }
      return parsedProgram;
    };
    if (hasCanonicalShopifyWebhookGate(file, readProgram)) return [];
    const entrypoint = getClassifiedWebhookEntrypoint(
      file,
      WEBHOOK_ENTRYPOINT_PATTERN,
      readProgram,
    );
    if (!entrypoint) return findings;
    if (entrypoint.index === null) return [];
    const location = getLocationAtIndex(file.content, entrypoint.index);
    return findings.map((finding) => ({ ...finding, ...location }));
  },
});
