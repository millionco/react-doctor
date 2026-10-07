import { describe, expect, it } from "vite-plus/test";
import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";

describe("parseTailwindClassNameToken", () => {
  it("separates stacked variants from the utility", () => {
    expect(parseTailwindClassNameToken("motion-safe:dark:hover:!bg-gradient-to-br")).toEqual({
      isImportant: true,
      utility: "bg-gradient-to-br",
      variants: ["motion-safe", "dark", "hover"],
    });
  });

  it("preserves colons inside arbitrary variants and values", () => {
    expect(
      parseTailwindClassNameToken(
        "supports-[selector(:focus-visible)]:hover:bg-[url(https://example.com/a:b)]",
      ),
    ).toEqual({
      isImportant: false,
      utility: "bg-[url(https://example.com/a:b)]",
      variants: ["supports-[selector(:focus-visible)]", "hover"],
    });
  });

  it("preserves colons inside parentheses, quotes, and nested brackets", () => {
    expect(
      parseTailwindClassNameToken(
        `supports-[selector(:is([data-state="a:b"],.ready))]:bg-(image:--hero:url("data:image/svg+xml:a:b"))`,
      ),
    ).toEqual({
      isImportant: false,
      utility: 'bg-(image:--hero:url("data:image/svg+xml:a:b"))',
      variants: ['supports-[selector(:is([data-state="a:b"],.ready))]'],
    });
  });

  it("distinguishes escaped separators from separators after escaped backslashes", () => {
    expect(parseTailwindClassNameToken(String.raw`hover\:focus:bg-red-500`)).toEqual({
      isImportant: false,
      utility: "bg-red-500",
      variants: [String.raw`hover\:focus`],
    });
    expect(parseTailwindClassNameToken(String.raw`hover\\:bg-red-500`)).toEqual({
      isImportant: false,
      utility: "bg-red-500",
      variants: [String.raw`hover\\`],
    });
  });

  it("normalizes trailing important modifiers", () => {
    expect(parseTailwindClassNameToken("dark:bg-clip-text!")).toEqual({
      isImportant: true,
      utility: "bg-clip-text",
      variants: ["dark"],
    });
  });

  it("does not treat important characters inside arbitrary values as modifiers", () => {
    expect(parseTailwindClassNameToken("content-['!']")).toEqual({
      isImportant: false,
      utility: "content-['!']",
      variants: [],
    });
    expect(parseTailwindClassNameToken(String.raw`utility\!`)).toEqual({
      isImportant: false,
      utility: String.raw`utility\!`,
      variants: [],
    });
  });

  it("preserves normal utility priority", () => {
    expect(parseTailwindClassNameToken("border-0")).toEqual({
      isImportant: false,
      utility: "border-0",
      variants: [],
    });
  });
});
