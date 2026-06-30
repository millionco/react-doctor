import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoRedirectInTryCatch } from "./nextjs-no-redirect-in-try-catch.js";

describe("nextjs/nextjs-no-redirect-in-try-catch — regressions", () => {
  it("stays silent on redirect() called from the catch block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    await mutate();
  } catch (e) {
    redirect("/login");
  }
}`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags redirect() inside the try block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    redirect("/login");
  } catch (e) {
    log(e);
  }
}`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
