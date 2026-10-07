import { describe, expect, it } from "vite-plus/test";
import { getProgramBrowserGlobalSyntax } from "./get-program-browser-global-syntax.js";
import { parseSourceText } from "./parse-source-file.js";

const parseProgram = (sourceText: string) => {
  const program = parseSourceText({
    filename: "/tmp/program-browser-global-syntax.ts",
    sourceText,
  });
  if (!program) throw new Error("Expected test source to parse");
  return program;
};

describe("getProgramBrowserGlobalSyntax", () => {
  it("indexes browser-global syntax once per program", () => {
    const program = parseProgram(`
      const currentPath = window[\`location\`].pathname;
      document.querySelector(currentPath);
    `);
    expect(getProgramBrowserGlobalSyntax(program)).toEqual({
      mayContainDocumentReference: true,
      mayContainLocationReference: true,
    });
  });

  it("stays false when neither browser-global token occurs", () => {
    const program = parseProgram(`const value = window.innerWidth;`);
    expect(getProgramBrowserGlobalSyntax(program)).toEqual({
      mayContainDocumentReference: false,
      mayContainLocationReference: false,
    });
  });
});
