import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (files: Readonly<Record<string, string>>): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-svelte-analysis-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify({ dependencies: { "@sveltejs/kit": "1.0.0" } }),
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const getUnusedFilePaths = async (rootDirectory: string): Promise<string[]> => {
  const result = await analyzeProject({ rootDirectory });
  return result.unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );
};

describe("SvelteKit project analysis", () => {
  it("treats instance export let declarations as component props", async () => {
    const rootDirectory = createProject({
      "src/routes/+page.svelte": `
        <script>
          import Widget from "../components/widget.svelte";
        </script>
        <Widget label="Visible" />
      `,
      "src/components/widget.svelte": `
        <script context="module">
          export let unusedModuleValue = true;
        </script>
        <script lang="ts">
          export let label: string;
          export const unusedValue = true;
        </script>
        <main>{label}</main>
      `,
    });

    const result = await analyzeProject({ rootDirectory });

    expect(
      result.unusedExports.map((unusedExport) => ({
        path: path.relative(rootDirectory, unusedExport.path).replaceAll("\\", "/"),
        name: unusedExport.name,
      })),
    ).toEqual([
      { path: "src/components/widget.svelte", name: "unusedModuleValue" },
      { path: "src/components/widget.svelte", name: "unusedValue" },
    ]);
  });

  it("resolves explicit wildcard aliases", async () => {
    const rootDirectory = createProject({
      "svelte.config.js": `export default { kit: { alias: {
        $docs: "src/docs",
        "$components/*": "src/components/*",
      } } };`,
      "src/routes/+page.ts": `
        import docs from "$docs/index.js";
        import card from "$components/card.js";
        console.log(docs, card);
      `,
      "src/docs/index.ts": "export default true;",
      "src/docs/orphan.ts": "export default true;",
      "src/components/card.ts": "export default true;",
    });

    await expect(getUnusedFilePaths(rootDirectory)).resolves.toEqual(["src/docs/orphan.ts"]);
  });

  it("expands only static import.meta.glob registries", async () => {
    const rootDirectory = createProject({
      "src/routes/+page.ts": `
        const previews = import.meta.glob("/src/previews/**/*.svelte");
        function Registry() { return new.target.glob("/src/dormant/**/*.svelte"); }
        const scope = "dormant";
        const dynamic = import.meta.glob(\`/src/\${scope}/**/*.svelte\`);
        console.log(previews, Registry, dynamic);
      `,
      "src/previews/button/index.svelte": "<main>Button</main>",
      "src/dormant/dialog/index.svelte": "<main>Dialog</main>",
    });

    await expect(getUnusedFilePaths(rootDirectory)).resolves.toEqual([
      "src/dormant/dialog/index.svelte",
    ]);
  });

  it("resolves query-suffixed source imports without broadening URL imports", async () => {
    const rootDirectory = createProject({
      "src/routes/+page.ts": `
        import rawType from "$docs/data/long-types/focus-prop.js?raw";
        import "data:text/javascript,export default true?raw";
        console.log(rawType);
      `,
      "svelte.config.js": `export default { kit: { alias: {
        "$docs/*": "src/docs/*",
      } } };`,
      "src/docs/data/long-types/focus-prop.ts": "export default true;",
      "src/docs/data/long-types/orphan.ts": "export default true;",
    });

    await expect(getUnusedFilePaths(rootDirectory)).resolves.toEqual([
      "src/docs/data/long-types/orphan.ts",
    ]);
  });
});

describe("Astro project analysis", () => {
  it("treats exported Props as the component prop contract", async () => {
    const rootDirectory = createProject({
      "src/pages/index.ts": `import "../components/card.astro";`,
      "src/components/card.astro": `---
export interface Props { title: string }
export const unusedValue = true;
const { title } = Astro.props;
---
<main>{title}</main>`,
    });

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/pages/index.ts"],
    });

    expect(result.unusedExports.map((unusedExport) => unusedExport.name)).toEqual(["unusedValue"]);
  });
});
