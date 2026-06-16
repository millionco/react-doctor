import { describe, expect, it } from "vite-plus/test";
import { stripStringLiteralsKeepingModuleSpecifiers } from "./strip-string-literals-keeping-module-specifiers.js";

describe("security-scan/utils/strip-string-literals-keeping-module-specifiers", () => {
  it("blanks string contents while preserving offsets, delimiters, and newlines", () => {
    const source = `const description = "ALWAYS fetch the numbers first";\nconst run = exec(cmd);`;
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).not.toContain("fetch");
    expect(stripped.split("\n")[0]).toMatch(/^const description = " +";$/);
    expect(stripped.split("\n")[1]).toBe("const run = exec(cmd);");
  });

  it("blanks template-literal text but keeps newlines for multi-line strings", () => {
    const source = "const help = `line one\nfetch line two`;\nconst keep = true;";
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).not.toContain("fetch");
    expect(stripped.split("\n")).toHaveLength(3);
    expect(stripped.split("\n")[2]).toBe("const keep = true;");
  });

  it("does not let an escaped quote close the string early", () => {
    const source = `const note = "say \\"exec\\" out loud"; const real = spawn(cmd);`;
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).not.toContain("exec");
    expect(stripped).toContain("spawn(cmd)");
  });

  it("keeps module-specifier strings: import, export-from, and require paths", () => {
    const source = [
      `import { execFile } from "node:child_process";`,
      `export { readFile } from "node:fs/promises";`,
      `const vm = require("node:vm");`,
      `const dynamic = import("node:child_process");`,
    ].join("\n");
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).toContain("node:child_process");
    expect(stripped).toContain("node:fs/promises");
    expect(stripped).toContain("node:vm");
    expect(stripped).toBe(source);
  });

  it("blanks member-access strings that merely look like an import", () => {
    const source = `const copy = Buffer.from("fetch the bytes");`;
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).not.toContain("fetch");
    expect(stripped).toMatch(/^const copy = Buffer\.from\(" +"\);$/);
  });

  it("keeps template `${…}` interpolation code while blanking the surrounding text", () => {
    const source = "const out = `please fetch ${exec(cmd)} right now`;";
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).toContain("exec(cmd)");
    expect(stripped).not.toContain("please fetch");
    expect(stripped).not.toContain("right now");
  });

  it("blanks prose strings nested inside an interpolation but keeps the call", () => {
    const source = "const out = `${runCommand({ shell: \"fetch the data\" })}`;";
    const stripped = stripStringLiteralsKeepingModuleSpecifiers(source);
    expect(stripped).toContain("runCommand({ shell:");
    expect(stripped).not.toContain("fetch the data");
  });
});
