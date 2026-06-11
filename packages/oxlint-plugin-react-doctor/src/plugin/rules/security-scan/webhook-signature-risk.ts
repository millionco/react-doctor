import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const WEBHOOK_HANDLER_PATTERN =
  /(?:^|\/)[^/]*webhook[^/]*\/|(?:^|\/)[^/]*webhook[^/]*\.[cm]?[jt]s$|\bwebhook\b/i;

const WEBHOOK_ENTRYPOINT_PATTERN =
  /\b(?:export\s+(?:async\s+)?function\s+POST|export\s+const\s+(?:POST|handler|webhook)|webhookHandler|webhookRoute)\b/i;

// Reading a `*-signature` header or delegating to a `verifyWebhook*` helper
// is verification evidence even when the HMAC math lives in another module.
const WEBHOOK_SIGNATURE_VERIFICATION_PATTERN =
  /verifySignature|verify.*signature|verify\w*(?:Webhook|Auth)|constructEvent|createHmac|timingSafeEqual|svix|webhookSecret|stripe\.webhooks|["'][\w-]*signature["']/i;

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

export const webhookSignatureRisk = defineRule({
  id: "webhook-signature-risk",
  title: "Webhook handler lacks signature verification",
  severity: "warn",
  recommendation:
    "Verify provider signatures before parsing or acting on webhook bodies. Use provider SDK helpers or HMAC verification with timing-safe comparison.",
  scan: scanByPattern({
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
  }),
});
