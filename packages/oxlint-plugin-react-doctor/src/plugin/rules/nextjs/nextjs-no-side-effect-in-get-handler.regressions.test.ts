import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoSideEffectInGetHandler } from "./nextjs-no-side-effect-in-get-handler.js";

describe("nextjs/nextjs-no-side-effect-in-get-handler — regressions", () => {
  it("stays silent on a read-only GET even on a mutating-sounding route", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `export async function GET() {
  const policy = await getCancellationPolicy();
  return Response.json(policy);
}`,
      { filename: "app/account/cancel/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an actual side effect on a mutating-sounding route", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `import { cookies } from "next/headers";
export async function GET() {
  cookies().delete("session");
  return Response.redirect("/");
}`,
      { filename: "app/logout/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a side effect one hop away in a same-file arrow helper", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `import { cookies } from "next/headers";
const destroySession = async () => {
  (await cookies()).delete("session");
};
export async function GET() {
  await destroySession();
  return Response.redirect("/");
}`,
      { filename: "app/logout/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a side effect one hop away in a same-file function declaration helper", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `import { cookies } from "next/headers";
async function destroySession() {
  (await cookies()).delete("session");
}
export async function GET() {
  await destroySession();
  return Response.redirect("/");
}`,
      { filename: "app/logout/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the same-file helper is read-only", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `const loadPolicy = async () => {
  return db.policy.findFirst({ where: { active: true } });
};
export async function GET() {
  const policy = await loadPolicy();
  return Response.json(policy);
}`,
      { filename: "app/account/cancel/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation wave: email-verification links must be GET-reachable
  // from a mail client, so the token-gated DB write is inherent to the flow
  // (devlovers verify-email shape — the doc's keep-GET case C).
  it("stays silent on a verify-email route's token-gated DB write", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `export async function GET(req) {
  const token = req.nextUrl.searchParams.get("token");
  const row = await db.select().from(tokens).where(eq(tokens.token, token)).limit(1);
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, row[0].userId));
  await db.delete(tokens).where(eq(tokens.token, token));
  return Response.redirect("/login?verified=1");
}`,
      { filename: "app/api/auth/verify-email/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation wave: an OAuth provider redirects the browser to the
  // callback with a GET; the state + PKCE checks mean a prefetch or forged
  // request cannot complete the exchange (umamin google callback shape).
  it("stays silent on an OAuth callback route's session-cookie writes", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `import { cookies } from "next/headers";
export async function GET(req) {
  const code = req.nextUrl.searchParams.get("code");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state")?.value ?? null;
  cookieStore.set("session", await exchangeCode(code), { httpOnly: true });
  return Response.redirect("/");
}`,
      { filename: "app/auth/google/callback/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation wave: `.update()` on a crypto HMAC/hash builder is an
  // in-memory computation, the doc's receiverless-.set/.update FP tell
  // (jumper-exchange strapi-preview shape).
  it("stays silent on crypto.createHmac(...).update(...) in a helper", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `import crypto from "crypto";
function isValidSecret(secret) {
  const key = Buffer.from("preview-secret-check");
  const hmacReceived = crypto.createHmac("sha256", key).update(secret ?? "").digest();
  const hmacExpected = crypto.createHmac("sha256", key).update(process.env.SECRET ?? "").digest();
  return crypto.timingSafeEqual(hmacReceived, hmacExpected);
}
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (!isValidSecret(searchParams.get("secret"))) {
    return Response.json({ error: "invalid" }, { status: 401 });
  }
  return Response.redirect("/preview");
}`,
      { filename: "src/app/api/strapi-preview/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a DB write on a non-token-exchange auth route", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `export async function GET(req) {
  await db.update(users).set({ lastSeen: new Date() });
  return Response.json({ ok: true });
}`,
      { filename: "app/api/auth/session/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not follow a second hop (helper calling another helper)", () => {
    const result = runRule(
      nextjsNoSideEffectInGetHandler,
      `import { cookies } from "next/headers";
const reallyDestroy = async () => {
  (await cookies()).delete("session");
};
const destroySession = async () => {
  await reallyDestroy();
};
export async function GET() {
  await destroySession();
  return Response.json({ ok: true });
}`,
      { filename: "app/logout/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
