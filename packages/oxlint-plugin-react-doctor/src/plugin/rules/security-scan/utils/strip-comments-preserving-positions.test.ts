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

  it("does not lex a regex literal's \\/\\/ as a line comment", () => {
    const source = "const urlPattern = /https:\\/\\//; const dangerous = eval(userInput);";
    const stripped = stripCommentsPreservingPositions(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).toContain("eval(userInput)");
  });

  it("does not let a quote inside a regex literal open string mode", () => {
    const source = 'const q = /"/; exec(cmd); // comment mentioning exec(evil)';
    const stripped = stripCommentsPreservingPositions(source);
    expect(stripped).toContain("exec(cmd)");
    expect(stripped).not.toContain("exec(evil)");
  });

  it("still treats a slash after a value as division", () => {
    const source = "const ratio = total / count / 2; // note";
    const stripped = stripCommentsPreservingPositions(source);
    expect(stripped).toContain("total / count / 2");
    expect(stripped).not.toContain("note");
  });

  it("closes an unbalanced quote at the line end instead of swallowing the file", () => {
    const source = "const x = <p>Don't worry</p>;\nexec(command); // trailing exec(evil)";
    const stripped = stripCommentsPreservingPositions(source);
    expect(stripped).toContain("exec(command)");
    expect(stripped).not.toContain("exec(evil)");
  });

  describe("stripCommentsAndStringLiteralsPreservingPositions", () => {
    it("blanks keywords that appear only inside string literals", () => {
      const source = `const description = "ALWAYS fetch the numbers first";`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).not.toContain("fetch");
      expect(stripped).toContain(`const description = "`);
    });

    it("keeps real call sites outside the quotes intact while blanking prose arguments", () => {
      const source = `const data = await fetch("all of the remote rows");`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toContain("fetch(");
      expect(stripped).not.toContain("remote rows");
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

    it("preserves single-token module specifiers in static imports", () => {
      const source = `import { execFile } from "node:child_process";`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toContain("node:child_process");
    });

    it("preserves specifiers in dynamic import() and require()", () => {
      const source = `const a = await import("axios");\nconst b = require("node-fetch");`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toContain('"axios"');
      expect(stripped).toContain('"node-fetch"');
    });

    it("preserves specifiers behind indirect require forms", () => {
      const source = `const a = (0, require)("axios");\nconst b = require?.("node-fetch");\nconst c = loadRequire("axios");`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped.match(/axios/g)).toHaveLength(2);
      expect(stripped).toContain("node-fetch");
    });

    it("blanks multi-word prose passed as a call argument", () => {
      const source = `transform("please fetch the rows");`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).not.toContain("fetch");
      expect(stripped).toContain("transform(");
    });

    it("preserves code inside template interpolations while blanking static text", () => {
      const source = "const out = `before ${fetch(url)} after`;";
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).toContain("fetch(url)");
      expect(stripped).not.toContain("before");
      expect(stripped).not.toContain("after");
    });

    it("resumes blanking template static text after a nested interpolation", () => {
      const source = "const out = `${id} please exec the rows`;";
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toContain("${id}");
      expect(stripped).not.toContain("exec");
    });

    it("does not grow output when a string ends with a trailing backslash", () => {
      const source = `const a = "ab\\`;
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
    });

    it("keeps code after a JSX apostrophe visible to the scan", () => {
      const source = "const x = <p>Don't worry</p>;\nexec(command); const y = 'z';";
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).toContain("exec(command)");
    });

    it("keeps code after a regex literal visible while blanking the regex body", () => {
      const source = "const urlPattern = /https:\\/\\//; const dangerous = eval(userInput);";
      const stripped = stripCommentsAndStringLiteralsPreservingPositions(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped).toContain("eval(userInput)");
      expect(stripped).not.toContain("https");
    });
  });
});
