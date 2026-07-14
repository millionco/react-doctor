import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoCssLink } from "./nextjs-no-css-link.js";

describe("nextjs/nextjs-no-css-link — remote stylesheets", () => {
  it("stays quiet on the authentic Mailing Typekit stylesheet", () => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = () => (
        <link rel="stylesheet" href="https://use.typekit.net/fih5ejy.css" />
      );`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports a local stylesheet that Next.js can bundle", () => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = () => <link rel="stylesheet" href="/styles.css" />;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
