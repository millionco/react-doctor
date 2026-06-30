import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoClientFetchForServerData } from "./nextjs-no-client-fetch-for-server-data.js";

describe("nextjs/nextjs-no-client-fetch-for-server-data — regressions", () => {
  it("stays silent on fetch inside an event handler declared in the effect", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => {
    const onSubmit = () => { fetch("/api/save", { method: "POST" }); };
    document.forms[0].addEventListener("submit", onSubmit);
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a direct fetch in the effect body", () => {
    const result = runRule(
      nextjsNoClientFetchForServerData,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => { fetch("/api/data"); }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
