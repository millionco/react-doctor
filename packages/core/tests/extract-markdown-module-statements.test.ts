import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSync } from "oxc-parser";
import { extractMarkdownModuleStatements } from "../src/project-analysis/utils/extract-markdown-module-statements.js";
import { parseSourceFile } from "../src/project-analysis/collect/parse.js";

describe("extractMarkdownModuleStatements", () => {
  it("extracts multiline imports and exports", () => {
    const sourceText = [
      "import {",
      "  Alpha,",
      "  Beta,",
      '} from "live-package"',
      "",
      "export {",
      "  Gamma,",
      '} from "exported-package"',
    ].join("\n");

    const extractedStatements = extractMarkdownModuleStatements(sourceText);
    expect(extractedStatements).toBe(sourceText);

    const parsedModule = parseSync("document.tsx", extractedStatements);
    expect(parsedModule.errors).toEqual([]);
    expect(
      parsedModule.module.staticImports.map((moduleImport) => moduleImport.moduleRequest.value),
    ).toEqual(["live-package"]);
    expect(
      parsedModule.module.staticExports.flatMap((moduleExport) =>
        moduleExport.entries.flatMap((entry) => entry.moduleRequest?.value ?? []),
      ),
    ).toEqual(["exported-package"]);
  });

  it("ignores fenced imports with CRLF line endings", () => {
    const sourceText = [
      "```tsx",
      'import Fenced from "fenced-package"',
      "```",
      "",
      'import Live from "live-package"',
    ].join("\r\n");

    const extractedStatements = extractMarkdownModuleStatements(sourceText);
    expect(extractedStatements).toContain('import Live from "live-package"');
    expect(extractedStatements).not.toContain("fenced-package");
    expect(extractedStatements).toHaveLength(sourceText.length);
  });

  it("ignores imports in frontmatter block scalars", () => {
    const sourceText = [
      "---",
      "description: |",
      '  import Frontmatter from "frontmatter-package"',
      "---",
      "",
      'import Live from "live-package"',
    ].join("\n");

    const extractedStatements = extractMarkdownModuleStatements(sourceText);
    expect(extractedStatements).toContain('import Live from "live-package"');
    expect(extractedStatements).not.toContain("frontmatter-package");
  });

  it("ignores imports in HTML comments", () => {
    const sourceText = [
      "<!--",
      'import Commented from "commented-package"',
      "-->",
      'import Live from "live-package"',
    ].join("\n");

    const extractedStatements = extractMarkdownModuleStatements(sourceText);
    expect(extractedStatements).toContain('import Live from "live-package"');
    expect(extractedStatements).not.toContain("commented-package");
  });

  it("ignores indented and inline import examples", () => {
    const sourceText = [
      '    import Indented from "indented-package"',
      "",
      'Use `import Inline from "inline-package"` in your application.',
      "",
      'import Live from "live-package"',
    ].join("\n");

    const extractedStatements = extractMarkdownModuleStatements(sourceText);
    expect(extractedStatements).toContain('import Live from "live-package"');
    expect(extractedStatements).not.toContain("indented-package");
    expect(extractedStatements).not.toContain("inline-package");
  });

  it("fails closed for malformed live module syntax", () => {
    expect(extractMarkdownModuleStatements('import { Broken from "broken-package"').trim()).toBe(
      "",
    );
  });

  it("recovers live imports around standalone MDX JSX", () => {
    const sourceText = [
      'import First from "first-package"',
      "",
      "<First />",
      "",
      'import Second from "second-package"',
    ].join("\n");

    const extractedStatements = extractMarkdownModuleStatements(sourceText);
    expect(extractedStatements).toContain('import First from "first-package"');
    expect(extractedStatements).toContain('import Second from "second-package"');
    expect(extractedStatements).not.toContain("<First />");
  });

  it("preserves JSX exports and exact source positions through Unicode and CRLF content", () => {
    const sourceText = [
      "# 😀 Player",
      "",
      'import { Broken from "broken-package"',
      "",
      'import Player from "player-package"',
      "",
      "export const PlayerExample = () => <Player />",
    ].join("\r\n");
    const rootDirectory = mkdtempSync(join(tmpdir(), "react-doctor-mdx-positions-"));
    const filePath = join(rootDirectory, "player.mdx");
    writeFileSync(filePath, sourceText);

    try {
      const parsedSource = parseSourceFile(filePath);
      expect(parsedSource.imports).toEqual([
        expect.objectContaining({ specifier: "player-package", line: 5, column: 0 }),
      ]);
      expect(parsedSource.exports).toEqual([
        expect.objectContaining({ name: "PlayerExample", line: 7, column: 13 }),
      ]);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
