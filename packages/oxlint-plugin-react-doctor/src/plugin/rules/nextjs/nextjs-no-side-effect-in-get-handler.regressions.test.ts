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
      { filename: "app/account/cancel/route.ts" }
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
      { filename: "app/logout/route.ts" }
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
