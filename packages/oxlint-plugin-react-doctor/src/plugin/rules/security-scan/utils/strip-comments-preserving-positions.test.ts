import { describe, expect, it } from "vite-plus/test";
import {
  stripCommentsAndStringLiteralsPreservingPositions,
  stripCommentsPreservingPositions,
} from "./strip-comments-preserving-positions.js";

describe("security-scan/utils/strip-comments-preserving-positions", () => {
  it("blanks line comments while preserving offsets and newlines", () => {
    const stripped = stripCommentsPreservingPositions(
      "const a = 1; // new Function(x)\nconst b = 2;",
    );
    expect(stripped).toHaveLength("const a = 1; // new Function(x)\nconst b = 2;".length);
    expect(stripped).not.toContain("new Function");
    expect(stripped.split("\n")[1]).toBe("const b = 2;");
  });

  it("blanks block comments but keeps their newlines", () => {
    const stripped = stripCommentsPreservingPositions(
      "/* eval(\n  payload\n) */\nconst safe = true;",
    );
    expect(stripped).not.toContain("eval");
    expect(stripped.split("\n")).toHaveLength(4);
  });

  it("keeps https:// URLs inside string literals intact", () => {
    const source = `const endpoint = "https://example.com/api"; // trailing note`;
    const stripped = stripCommentsPreservingPositions(source);
    expect(stripped).toContain("https://example.com/api");
    expect(stripped).not.toContain("trailing note");
  });

  it("does not treat // inside template literals as a comment", () => {
    const source = "const url = `https://example.com/${path}`;";
    expect(stripCommentsPreservingPositions(source)).toBe(source);
  });

  describe("stripCommentsAndStringLiteralsPreservingPositions", () => {
    it("blanks keywords that appear only inside string literals", () => {
      const source = `const description = "ALWAYS fetch the numbers first";`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).not.toContain("fetch");
      expect(stripped).toContain(`const description = "`);
    });

    it("keeps real call sites outside the quotes intact", () => {
      const source = `const data = await fetch("https://example.com/api");`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toContain("fetch(");
      expect(stripped).not.toContain("https://example.com");
    });

    it("preserves newlines inside multi-line template literals", () => {
      const source = "const sql = `select\n  exec\nfrom t`;\nconst safe = true;";
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).not.toContain("exec");
      expect(stripped.split("\n")[3]).toBe("const safe = true;");
    });

    it("blanks escaped characters without dropping offsets", () => {
      const source = `const quote = "say \\"eval\\" now";`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).not.toContain("eval");
    });
  });
});
