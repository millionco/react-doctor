import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { webhookSignatureRisk } from "./webhook-signature-risk.js";

describe("security-scan/webhook-signature-risk — regressions", () => {
  it("flags an inbound webhook handler with no verification", () => {
    const findings = runScanRule(webhookSignatureRisk, {
      relativePath: "src/app/api/webhooks/github/route.ts",
      content: `export async function POST(request: Request) {\n  const event = await request.json();\n  await applyEvent(event);\n  return Response.json({ ok: true });\n}\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on outbound webhook-URL forwarding (twenty partner-application shape)", () => {
    const findings = runScanRule(webhookSignatureRisk, {
      relativePath: "src/app/api/partner-application/route.ts",
      content: `const webhookUrlSchema = z.string().pipe(z.httpUrl({ error: "Invalid webhook URL." }));\nexport async function POST(request: Request) {\n  const webhookUrlResult = webhookUrlSchema.safeParse(process.env.PARTNER_APPLICATION_WEBHOOK_URL);\n  if (!webhookUrlResult.success) {\n    return Response.json({ error: "Partner application webhook is not configured." });\n  }\n  await fetch(webhookUrlResult.data, { method: "POST", body: await request.text() });\n  return Response.json({ ok: true });\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on bare handler re-exports (langfuse stripe-webhook shape)", () => {
    const findings = runScanRule(webhookSignatureRisk, {
      relativePath: "src/app/api/billing/stripe-webhook/route.ts",
      content: `import { stripeWebhookHandler } from "@/src/ee/features/billing/stripeWebhookHandler";\n\nexport const POST = stripeWebhookHandler;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when verification is delegated to an extracted helper (#814)", () => {
    const findings = runScanRule(webhookSignatureRisk, {
      relativePath: "src/app/api/webhooks/provider/route.ts",
      content: `import { isValidSecret } from "./verify";\nexport async function POST(request: Request) {\n  const token = request.headers.get("x-webhook-token");\n  if (!isValidSecret(token, process.env.PROVIDER_SECRET)) return new Response("no", { status: 401 });\n  const event = await request.json();\n  return Response.json({ ok: event.type });\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  // Guard against catastrophic backtracking: the verification regex must run in
  // linear time on a long identifier-like run. If it regresses to nested
  // unbounded `[A-Za-z]*`, this scan hangs and the test times out.
  it("does not catastrophically backtrack on a long verb-like run (ReDoS guard)", () => {
    const findings = runScanRule(webhookSignatureRisk, {
      relativePath: "src/app/api/webhooks/x/route.ts",
      content: `export async function POST(request: Request) {\n  const ${"valid".repeat(5000)} = 1;\n  const event = await request.json();\n  return Response.json({ ok: true });\n}\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
