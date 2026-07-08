import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsAsyncClientComponent } from "./nextjs-async-client-component.js";

describe("nextjs/nextjs-async-client-component — regressions", () => {
  it('flags an async component in a "use client" file', () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `"use client";
export default async function Profile() {
  const data = await loadProfile();
  return <div>{data.name}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('stays silent for an async component without "use client"', () => {
    const result = runRule(
      nextjsAsyncClientComponent,
      `export default async function Profile() {
  const data = await loadProfile();
  return <div>{data.name}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
