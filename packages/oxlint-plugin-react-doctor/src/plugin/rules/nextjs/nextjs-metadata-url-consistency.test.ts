import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsMetadataUrlConsistency } from "./nextjs-metadata-url-consistency.js";

const run = (code: string) =>
  runRule(nextjsMetadataUrlConsistency, code, { filename: "/app/docs/page.tsx" });

describe("nextjs-metadata-url-consistency", () => {
  it("flags contradictory static URLs", () => {
    const result = run(
      `export const metadata = { alternates: { canonical: "https://example.com/docs" }, openGraph: { url: "https://example.com/help" } };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts matching absolute URLs with normalized trailing slashes", () => {
    const result = run(
      `export const metadata = { alternates: { canonical: "https://example.com/docs" }, openGraph: { url: "https://example.com/docs/" } };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts matching relative URLs", () => {
    const result = run(
      `export const metadata = { metadataBase: new URL("https://example.com"), alternates: { canonical: "/docs" }, openGraph: { url: "/docs" } };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the last duplicate metadata property", () => {
    const matchingResult = run(
      `export const metadata = { alternates: { canonical: "/old", canonical: "/docs" }, openGraph: { url: "/wrong", url: "/docs" } };`,
    );
    expect(matchingResult.diagnostics).toEqual([]);

    const contradictoryResult = run(
      `export const metadata = { alternates: { canonical: "/docs", canonical: "/latest" }, openGraph: { url: "/latest", url: "/social" } };`,
    );
    expect(contradictoryResult.diagnostics).toHaveLength(1);
  });

  it("skips metadata properties with later dynamic override barriers", () => {
    const result = run(
      `export const metadata = { alternates: { canonical: "/docs", ...alternates }, openGraph: { url: "/social", [propertyName]: value } };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores dynamic URL values", () => {
    const result = run(
      `export const metadata = { alternates: { canonical }, openGraph: { url: buildUrl() } };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unexported metadata-shaped objects", () => {
    const result = run(
      `const metadata = { alternates: { canonical: "/a" }, openGraph: { url: "/b" } };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores metadata-shaped exports outside App Router page and layout files", () => {
    const result = runRule(
      nextjsMetadataUrlConsistency,
      `export const metadata = { alternates: { canonical: "/a" }, openGraph: { url: "/b" } };`,
      { filename: "/src/content/metadata.ts" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
