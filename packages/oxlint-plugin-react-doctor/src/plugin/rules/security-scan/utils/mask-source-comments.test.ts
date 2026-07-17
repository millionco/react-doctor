import { describe, expect, it } from "vite-plus/test";
import { maskSourceComments } from "./mask-source-comments.js";

describe("maskSourceComments", () => {
  it("masks line and block comment text while preserving line breaks and length", () => {
    const content = `const emoji = "😀"; // process.env.DATABASE_URL
/* import.meta.env.SESSION_SECRET */
const value = process.env.DATABASE_URL;`;
    const maskedContent = maskSourceComments("client.ts", content);

    expect(maskedContent).not.toBeUndefined();
    if (maskedContent === undefined) return;
    expect(maskedContent).toHaveLength(content.length);
    expect(maskedContent.split("\n")).toHaveLength(content.split("\n").length);
    expect(maskedContent).not.toContain("SESSION_SECRET");
    expect(maskedContent).toContain("const value = process.env.DATABASE_URL;");
  });

  it("preserves comment-like text inside strings and templates", () => {
    const content = `const url = "https://example.com/process.env.DATABASE_URL";
const template = \`/* import.meta.env.SESSION_SECRET */\`;`;

    expect(maskSourceComments("client.ts", content)).toBe(content);
  });

  it("masks hashbang text while preserving executable source", () => {
    const content = `#!/usr/bin/env -S node process.env.DATABASE_URL
export const databaseUrl = process.env.DATABASE_URL;`;
    const maskedContent = maskSourceComments("client.ts", content);

    expect(maskedContent).not.toBeUndefined();
    if (maskedContent === undefined) return;
    expect(maskedContent).toHaveLength(content.length);
    expect(maskedContent).not.toContain("#!/usr/bin/env");
    expect(maskedContent).toContain("export const databaseUrl = process.env.DATABASE_URL;");
  });

  it.each(["\u2028", "\u2029"])(
    "stops hashbang masking at an ECMAScript line terminator",
    (separator) => {
      const content = `#!/usr/bin/env node process.env.DATABASE_URL${separator}export const databaseUrl = process.env.DATABASE_URL;`;
      const maskedContent = maskSourceComments("client.js", content);

      expect(maskedContent).not.toBeUndefined();
      if (maskedContent === undefined) return;
      expect(maskedContent).toHaveLength(content.length);
      expect(maskedContent).not.toContain("#!/usr/bin/env");
      expect(maskedContent).toContain("export const databaseUrl = process.env.DATABASE_URL;");
    },
  );

  it.each(["\u2028", "\u2029"])(
    "preserves ECMAScript line terminators inside comments",
    (separator) => {
      const content = `/* process.env.DATABASE_URL${separator}still a comment */${separator}export const databaseUrl = process.env.DATABASE_URL;`;
      const maskedContent = maskSourceComments("client.js", content);

      expect(maskedContent).not.toBeUndefined();
      if (maskedContent === undefined) return;
      expect(maskedContent).toHaveLength(content.length);
      expect(maskedContent.split(separator)).toHaveLength(3);
      expect(maskedContent).not.toContain("still a comment");
      expect(maskedContent).toContain("export const databaseUrl = process.env.DATABASE_URL;");
    },
  );

  it.each([
    ["opening", `<!-- process.env.DATABASE_URL\nvar client = {};`],
    ["closing", `var client = {};\n  --> process.env.DATABASE_URL\nclient.ready = true;`],
  ])("masks an Annex-B HTML %s comment", (_label, content) => {
    const maskedContent = maskSourceComments("client.js", content);

    expect(maskedContent).not.toBeUndefined();
    if (maskedContent === undefined) return;
    expect(maskedContent).toHaveLength(content.length);
    expect(maskedContent).not.toContain("DATABASE_URL");
    expect(maskedContent).toContain("client");
  });

  it("does not treat a postfix decrement comparison as an Annex-B closing comment", () => {
    const content = `var isPositive = value-->0;\nvar databaseUrl = process.env.DATABASE_URL;`;
    expect(maskSourceComments("client.js", content)).toBe(content);
  });

  it("does not treat an HTML --!> close as an Annex-B JavaScript comment", () => {
    const content = `--!> process.env.DATABASE_URL`;
    expect(maskSourceComments("client.js", content)).toBe(content);
  });

  it("returns non-source artifacts unchanged", () => {
    const content = `{"source":"/* process.env.DATABASE_URL */"}`;
    expect(maskSourceComments("client.js.map", content)).toBe(content);
  });

  it("returns source without possible comment markers unchanged", () => {
    const content = `export const databaseUrl = process.env.DATABASE_URL;`;
    expect(maskSourceComments("client.js", content)).toBe(content);
  });

  it("returns undefined for malformed source", () => {
    const content = `const value = process.env.DATABASE_URL ??? // docs`;
    expect(maskSourceComments("client.ts", content)).toBeUndefined();
  });
});
