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

  it.each([
    `href="http://cdn.example.com/theme.css"`,
    `href="HTTPS://cdn.example.com/theme.css"`,
    `href={"https://cdn.example.com/theme.css"}`,
    "href={`https://cdn.example.com/theme.css`}",
  ])("stays quiet on a statically proven remote stylesheet: %s", (hrefAttribute) => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = () => <link rel="stylesheet" ${hrefAttribute} />;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when every statically known href branch is remote", () => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = ({ usePrimary }) => (
        <link
          rel="stylesheet"
          href={usePrimary ? "https://cdn.example.com/primary.css" : "https://cdn.example.com/fallback.css"}
        />
      );`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a const alias of a remote stylesheet", () => {
    const result = runRule(
      nextjsNoCssLink,
      `const themeUrl = "https://cdn.example.com/theme.css";
      export const DocumentHead = () => <link rel="stylesheet" href={themeUrl} />;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports when a later spread can override a remote href", () => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = ({ linkProps }) => (
        <link rel="stylesheet" href="https://cdn.example.com/theme.css" {...linkProps} />
      );`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when an explicit remote href follows a spread", () => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = ({ linkProps }) => (
        <link rel="stylesheet" {...linkProps} href="https://cdn.example.com/theme.css" />
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

  it.each([
    `href="styles.css"`,
    `href="./styles.css"`,
    `href="//cdn.example.com/theme.css"`,
    `href={themeUrl}`,
    `href={useRemote ? "https://cdn.example.com/theme.css" : "/styles.css"}`,
  ])("remains conservative when the href is not proven HTTP(S): %s", (hrefAttribute) => {
    const result = runRule(
      nextjsNoCssLink,
      `export const DocumentHead = ({ themeUrl, useRemote }) => (
        <link rel="stylesheet" ${hrefAttribute} />
      );`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
