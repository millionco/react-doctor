import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndexInput } from "./build-source-project-index.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseAstroSourceFile } from "./parse-astro-source-file.js";
import { parseSourceText } from "./parse-source-file.js";

const ASTRO_IMPORTS = `---
import { title } from "./frontmatter";
---
<h1>{title}</h1>
<script>
  import { mount } from "./client";
  mount();
</script>
`;

const indexAstroProject = (
  astroSource: string,
  options: Pick<SourceProjectIndexInput, "includeAstroSources"> = {},
) => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "astro-source-project-index-"));
  try {
    const currentFilePath = normalizeFilename(path.join(rootDirectory, "entry.ts"));
    const frontmatterFilePath = normalizeFilename(path.join(rootDirectory, "frontmatter.ts"));
    const clientFilePath = normalizeFilename(path.join(rootDirectory, "client.ts"));
    const astroFilePath = normalizeFilename(path.join(rootDirectory, "page.astro"));
    const currentSource = "export {};";

    fs.writeFileSync(currentFilePath, currentSource);
    fs.writeFileSync(frontmatterFilePath, 'export const title = "Heading";');
    fs.writeFileSync(clientFilePath, "export const mount = () => {};");
    fs.writeFileSync(astroFilePath, astroSource);

    const currentProgramNode = parseSourceText({
      filename: currentFilePath,
      sourceText: currentSource,
    });
    if (!currentProgramNode || !isNodeOfType(currentProgramNode, "Program"))
      throw new Error("Could not parse the synthetic entry module");

    return {
      index: buildSourceProjectIndex({
        rootDirectory,
        currentFilePath,
        currentProgramNode,
        currentScopes: analyzeScopes(currentProgramNode),
        ...options,
      }),
      astroFilePath,
      frontmatterFilePath,
      clientFilePath,
    };
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
};

describe("buildSourceProjectIndex Astro consumers", () => {
  it("reuses an Astro AST until the file changes, even if its size and mtime stay fixed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "astro-source-cache-"));
    const filename = path.join(root, "page.astro");
    const timestamp = new Date("2000-01-01T00:00:00.000Z");
    try {
      fs.writeFileSync(filename, "<p>hello</p>");
      fs.utimesSync(filename, timestamp, timestamp);
      const first = parseAstroSourceFile(filename);
      expect(first).not.toBeNull();
      expect(parseAstroSourceFile(filename)).toBe(first);

      const replacement = path.join(root, "replacement.astro");
      fs.writeFileSync(replacement, "<p>world</p>");
      fs.utimesSync(replacement, timestamp, timestamp);
      fs.renameSync(replacement, filename);
      const updated = parseAstroSourceFile(filename);
      expect(updated).not.toBeNull();
      expect(updated).not.toBe(first);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes frontmatter and inline script imports when opted in", () => {
    const { index, astroFilePath, frontmatterFilePath, clientFilePath } = indexAstroProject(
      ASTRO_IMPORTS,
      { includeAstroSources: true },
    );
    const astroModule = index?.modulesByFilePath.get(astroFilePath);
    expect(astroModule?.filePath).toBe(astroFilePath);
    expect(index?.consumerModulesByFilePath.get(frontmatterFilePath)).toEqual(
      new Set([astroModule]),
    );
    expect(index?.consumerModulesByFilePath.get(clientFilePath)).toEqual(new Set([astroModule]));
  });

  it("omits Astro consumers by default", () => {
    const { index, astroFilePath, frontmatterFilePath, clientFilePath } =
      indexAstroProject(ASTRO_IMPORTS);
    expect(index?.modulesByFilePath.has(astroFilePath)).toBe(false);
    expect(index?.consumerModulesByFilePath.has(frontmatterFilePath)).toBe(false);
    expect(index?.consumerModulesByFilePath.has(clientFilePath)).toBe(false);
  });

  it.each([
    ["script src", '<script src="./client.ts"></script>'],
    [
      "spread script attributes",
      "---\nconst attributes = { defer: true };\n---\n<script {...attributes}></script>",
    ],
  ])("refuses an opted-in Astro project with %s", (_name, astroSource) => {
    expect(indexAstroProject(astroSource, { includeAstroSources: true }).index).toBeNull();
  });
});
