import { describe, expect, it } from "vite-plus/test";
import { stripStringLiteralsPreservingPositions } from "./strip-string-literals-preserving-positions.js";

describe("security-scan/utils/strip-string-literals-preserving-positions", () => {
  it("blanks string contents while preserving offsets, delimiters, and newlines", () => {
    const source = `const description = "ALWAYS fetch the numbers first";\nconst run = exec(cmd);`;
    const stripped = stripStringLiteralsPreservingPositions(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).not.toContain("fetch");
    expect(stripped.split("\n")[0]).toMatch(/^const description = " +";$/);
    expect(stripped.split("\n")[1]).toBe("const run = exec(cmd);");
  });

  it("blanks template-literal text but keeps newlines for multi-line strings", () => {
    const source = "const help = `line one\nfetch line two`;\nconst keep = true;";
    const stripped = stripStringLiteralsPreservingPositions(source);
    expect(stripped).not.toContain("fetch");
    expect(stripped.split("\n")).toHaveLength(3);
    expect(stripped.split("\n")[2]).toBe("const keep = true;");
  });

  it("does not let an escaped quote close the string early", () => {
    const source = `const note = "say \\"exec\\" out loud"; const real = spawn(cmd);`;
    const stripped = stripStringLiteralsPreservingPositions(source);
    expect(stripped).not.toContain("exec");
    expect(stripped).toContain("spawn(cmd)");
  });
});
