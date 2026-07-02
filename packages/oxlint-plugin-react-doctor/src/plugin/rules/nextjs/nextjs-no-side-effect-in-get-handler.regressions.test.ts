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
