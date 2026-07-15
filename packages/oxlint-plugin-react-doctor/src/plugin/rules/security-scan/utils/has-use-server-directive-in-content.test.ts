import { describe, expect, it } from "vite-plus/test";
import { hasUseServerDirectiveInContent } from "./has-use-server-directive-in-content.js";

describe("security-scan/utils/has-use-server-directive-in-content", () => {
  it("detects double-quoted 'use server' directive at file start", () => {
    expect(hasUseServerDirectiveInContent('"use server";\n\nexport const foo = 1;')).toBe(true);
  });

  it("detects single-quoted 'use server' directive at file start", () => {
    expect(hasUseServerDirectiveInContent("'use server';\n\nexport const foo = 1;")).toBe(true);
  });

  it("detects 'use server' after leading whitespace", () => {
    expect(hasUseServerDirectiveInContent('  "use server";\n\nexport const foo = 1;')).toBe(true);
  });

  it("detects 'use server' after blank lines", () => {
    expect(hasUseServerDirectiveInContent('\n\n"use server";\n\nexport const foo = 1;')).toBe(true);
  });

  it("does not detect 'use server' in the middle of the file", () => {
    expect(
      hasUseServerDirectiveInContent('const foo = 1;\n\n"use server";\n\nexport const bar = 2;'),
    ).toBe(false);
  });

  it("does not detect 'use server' in comments", () => {
    expect(hasUseServerDirectiveInContent('// "use server";\n\nexport const foo = 1;')).toBe(false);
  });

  it("does not detect files without 'use server'", () => {
    expect(hasUseServerDirectiveInContent("export const foo = 1;")).toBe(false);
  });

  it("does not detect 'use client' as 'use server'", () => {
    expect(hasUseServerDirectiveInContent('"use client";\n\nexport const foo = 1;')).toBe(false);
  });

  it("handles empty files", () => {
    expect(hasUseServerDirectiveInContent("")).toBe(false);
  });
});
