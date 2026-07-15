import { describe, expect, it } from "vite-plus/test";
import { maskSourceComments } from "./mask-source-comments.js";

describe("maskSourceComments", () => {
  it("masks line and block comment text while preserving line breaks and length", () => {
    const content = `const emoji = "😀"; // process.env.DATABASE_URL
/* import.meta.env.SESSION_SECRET */
const value = process.env.DATABASE_URL;`;
    const maskedContent = maskSourceComments("client.ts", content);

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

    expect(maskedContent).toHaveLength(content.length);
    expect(maskedContent).not.toContain("#!/usr/bin/env");
    expect(maskedContent).toContain("export const databaseUrl = process.env.DATABASE_URL;");
  });

  it("returns non-source artifacts unchanged", () => {
    const content = `{"source":"/* process.env.DATABASE_URL */"}`;
    expect(maskSourceComments("client.js.map", content)).toBe(content);
  });

  it("returns malformed source unchanged", () => {
    const content = `const value = process.env.DATABASE_URL ??? // docs`;
    expect(maskSourceComments("client.ts", content)).toBe(content);
  });
});
