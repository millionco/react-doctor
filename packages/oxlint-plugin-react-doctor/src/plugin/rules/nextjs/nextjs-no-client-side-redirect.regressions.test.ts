import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoClientSideRedirect } from "./nextjs-no-client-side-redirect.js";

describe("nextjs/nextjs-no-client-side-redirect — regressions", () => {
  it("stays silent on router.push inside an event handler registered in the effect", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const button = document.getElementById("go");
    const onClick = () => { router.push("/next"); };
    button.addEventListener("click", onClick);
    return () => button.removeEventListener("click", onClick);
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a direct router.push on mount", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => { router.push("/x"); }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
