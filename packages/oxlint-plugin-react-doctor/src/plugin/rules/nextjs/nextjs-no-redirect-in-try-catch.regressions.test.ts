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
}`,
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
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on redirect() inside a deferred handler in the try block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default function Page() {
  try {
    return <button onClick={() => redirect("/login")}>Go</button>;
  } catch (e) {
    return null;
  }
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the catch re-throws the control-flow error", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    await save();
    redirect("/done");
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a local redirect function that shadows next/navigation", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `export default function Page() {
  const redirect = (url) => { window.location.href = url; };
  try {
    redirect("/done");
  } catch (e) {
    console.error(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
