import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";
import { expandBuildScriptPaths } from "../src/project-analysis/collect/build-script-consumed-files.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  packageJson: Readonly<Record<string, unknown>>,
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-build-consumers-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const relativeUnusedFiles = async (rootDirectory: string): Promise<string[]> => {
  const result = await analyzeProject({ rootDirectory });
  return result.unusedFiles.map((finding) =>
    path.relative(rootDirectory, finding.path).replaceAll("\\", "/"),
  );
};

describe("build-script filesystem consumers", () => {
  it("expands a Vite config seed through its static plugin helper tree", () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `import { createPlugins } from "./build/plugins"; export default { plugins: createPlugins() };`,
        "build/plugins/index.ts": `import { setupInspect } from "./inspect"; export const createPlugins = () => [setupInspect()];`,
        "build/plugins/inspect.ts": `import Inspect from "vite-plugin-inspect"; export const setupInspect = () => Inspect();`,
        "build/unrelated.ts": "export const unrelated = true;",
      },
      { devDependencies: { vite: "1.0.0", "vite-plugin-inspect": "1.0.0" } },
    );

    expect(
      expandBuildScriptPaths({
        projectRoot: rootDirectory,
        initialPaths: [path.join(rootDirectory, "vite.config.ts")],
      }).map((filePath) => path.relative(rootDirectory, filePath).replaceAll("\\", "/")),
    ).toEqual(["vite.config.ts", "build/plugins/index.ts", "build/plugins/inspect.ts"]);
  });

  it("keeps registry source and generated files used by an invoked registry builder", async () => {
    const rootDirectory = createProject(
      {
        "src/scripts/build-registry.mts": `
          import fs from "node:fs";
          import path from "node:path";
          import { registry } from "../registry";
          import { styles } from "../registry/registry-styles";
          for (const style of styles) for (const file of registry[0].files) {
            fs.readFileSync(path.join(process.cwd(), "src/registry", style.name, file.path), "utf8");
          }
        `,
        "src/registry/index.ts": `import { ui } from "@/registry/registry-ui"; export const registry = ui;`,
        "src/registry/registry-styles.ts": `export const styles = [{ name: "default" }];`,
        "src/registry/registry-ui.ts": `export const ui = [{ files: [{ path: "ui/button.tsx" }] }];`,
        "src/registry/default/ui/button.tsx": "export const Button = () => null;",
        "src/registry/default/ui/legacy.tsx": "export const Legacy = () => null;",
        "src/__registry__/default/button.tsx": "export const Button = () => null;",
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
        }),
        "src/orphan.ts": "export const orphan = true;",
      },
      { scripts: { "build:registry": "tsx src/scripts/build-registry.mts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual([
      "src/orphan.ts",
      "src/registry/default/ui/legacy.tsx",
    ]);
  });

  it("keeps files enumerated by shadcn and script-read registry manifests", async () => {
    const rootDirectory = createProject(
      {
        "registry.json": JSON.stringify({
          $schema: "https://ui.shadcn.com/schema.json",
          items: [{ files: [{ path: "src/registry/button.tsx" }] }],
        }),
        "packages/templates/registry.json": JSON.stringify({
          components: [{ files: [{ path: "packages/templates/react/**/*" }] }],
        }),
        "packages/cli/src/scripts/build-registry.ts": `
          import fs from "node:fs";
          import path from "node:path";
          fs.readFileSync(path.join(process.cwd(), "/packages/templates/registry.json"), "utf8");
          const walk = (directory) => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
              if (entry.isDirectory()) walk(path.join(directory, entry.name));
            }
          };
          walk(path.join(process.cwd(), "packages/templates/react"));
        `,
        "src/registry/button.tsx": "export const Button = () => null;",
        "packages/templates/react/routes/button.ts": "export const template = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      {
        scripts: {
          "build:shadcn": "npx shadcn@latest build",
          "build:templates": "tsx packages/cli/src/scripts/build-registry.ts",
        },
      },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/orphan.ts"]);
  });

  it("keeps sources embedded by a rendered registry preview without widening stale artifacts", async () => {
    const publishedSource = "export const published = true;";
    const rootDirectory = createProject(
      {
        "registry.json": JSON.stringify({
          $schema: "https://ui.shadcn.com/schema.json",
          items: [],
        }),
        "content/components.mdx": [
          "{/**/}",
          "<PreviewComponents",
          '  registryName={"published"}',
          "/>",
          "",
          '<!-- <PreviewComponents registryName="commented" /> -->',
          "",
          "{/*",
          '  <PreviewComponents registryName="jsx-commented" />',
          "*/}",
          "",
          "```tsx",
          '<PreviewComponents registryName="fenced" />',
          "```",
        ].join("\n"),
        "public/r/published.json": JSON.stringify({
          name: "published",
          type: "registry:block",
          files: [
            {
              path: "src/registry/published.tsx",
              content: publishedSource,
              target: "components/published.tsx",
            },
            {
              path: "src/registry/stale.tsx",
              content: "export const stale = 'old';",
              target: "components/stale.tsx",
            },
          ],
        }),
        "public/r/commented.json": JSON.stringify({
          name: "commented",
          type: "registry:block",
          files: [
            {
              path: "src/registry/commented.tsx",
              content: "export const commented = true;",
            },
          ],
        }),
        "public/r/fenced.json": JSON.stringify({
          name: "fenced",
          type: "registry:block",
          files: [
            {
              path: "src/registry/fenced.tsx",
              content: "export const fenced = true;",
            },
          ],
        }),
        "public/r/jsx-commented.json": JSON.stringify({
          name: "jsx-commented",
          type: "registry:block",
          files: [
            {
              path: "src/registry/jsx-commented.tsx",
              content: "export const jsxCommented = true;",
            },
          ],
        }),
        "src/registry/published.tsx": publishedSource,
        "src/registry/stale.tsx": "export const stale = 'current';",
        "src/registry/commented.tsx": "export const commented = true;",
        "src/registry/fenced.tsx": "export const fenced = true;",
        "src/registry/jsx-commented.tsx": "export const jsxCommented = true;",
      },
      { scripts: { "build:shadcn": "npx shadcn@latest build" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual([
      "src/registry/commented.tsx",
      "src/registry/fenced.tsx",
      "src/registry/jsx-commented.tsx",
      "src/registry/stale.tsx",
    ]);
  });

  it("resolves workspace scripts and manifests from the package working directory", async () => {
    const rootDirectory = createProject(
      {
        "packages/application/package.json": JSON.stringify({
          scripts: { "build:registry": 'tsx "scripts/build-registry.ts"' },
        }),
        "packages/application/scripts/build-registry.ts": `
          import fs from "node:fs";
          fs.readFileSync("registry.json", "utf8");
        `,
        "packages/application/registry.json": JSON.stringify({
          files: [{ path: "src/registry/button.tsx" }],
        }),
        "packages/application/src/registry/button.tsx": "export const Button = () => null;",
        "src/registry/button.tsx": "export const RootButton = () => null;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).toContain("src/registry/button.tsx");
    expect(unusedFiles).not.toContain("packages/application/src/registry/button.tsx");
  });

  it("preserves each workspace context for a shared invoked script", async () => {
    const rootDirectory = createProject(
      {
        "packages/one/package.json": JSON.stringify({
          scripts: { build: "tsx ../../scripts/build-registry.ts" },
        }),
        "packages/two/package.json": JSON.stringify({
          scripts: { build: "tsx ../../scripts/build-registry.ts" },
        }),
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          fs.readFileSync("registry.json", "utf8");
        `,
        "packages/one/registry.json": JSON.stringify({
          files: [{ path: "src/registry/one.ts" }],
        }),
        "packages/two/registry.json": JSON.stringify({
          files: [{ path: "src/registry/two.ts" }],
        }),
        "packages/one/src/registry/one.ts": "export const one = true;",
        "packages/two/src/registry/two.ts": "export const two = true;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toContain("packages/one/src/registry/one.ts");
    expect(unusedFiles).not.toContain("packages/two/src/registry/two.ts");
  });

  it("keeps a recursive generator input directory without excluding unrelated directories", async () => {
    const rootDirectory = createProject(
      {
        "scripts/generate-plugins.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const projectDirectory = path.join(__dirname, "..");
          const extrasDirectory = path.join(projectDirectory, "extras");
          function copyPlugins(sourceDirectory, destinationDirectory) {
            for (const item of fs.readdirSync(sourceDirectory)) {
              fs.copyFileSync(path.join(sourceDirectory, item), path.join(destinationDirectory, item));
            }
          }
          copyPlugins(extrasDirectory, path.join(process.cwd(), "src/plugins"));
        `,
        "extras/plugin.ts": "export const plugin = true;",
        "examples/orphan.ts": "export const orphan = true;",
      },
      { scripts: { "generate-plugins": "tsx scripts/generate-plugins.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["examples/orphan.ts"]);
  });

  it("follows invoked local imports to recursively consumed template manifests", async () => {
    const rootDirectory = createProject(
      {
        "packages/cli/package.json": JSON.stringify({
          scripts: { build: "tsup src/index.ts" },
        }),
        "packages/cli/src/index.ts": `import { build } from "./build.js"; build();`,
        "packages/cli/src/build.ts": `
          import fs from "node:fs";
          import path from "node:path";
          export const build = () => {
            const registryPath = path.join(
              process.cwd(),
              "/packages/templates/registry.json",
            );
            const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
            const sourceBase = registry.files[0].path.split("*")[0];
            const walk = (directory) => fs.readdirSync(directory);
            walk(sourceBase);
          };
        `,
        "packages/templates/registry.json": JSON.stringify({
          files: [{ path: "packages/templates/react/**/*" }],
        }),
        "packages/templates/react/routes/button.ts": "export const template = true;",
        "packages/templates/orphan.ts": "export const orphan = true;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toContain("packages/templates/react/routes/button.ts");
    expect(unusedFiles).toContain("packages/templates/orphan.ts");
  });

  it("follows called default-exported build helpers without executing dormant helpers", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build.ts": `
          import buildNamedFunction from "./named-function";
          import buildAnonymousFunction from "./anonymous-function";
          import buildNamedArrow from "./named-arrow";
          import buildAnonymousArrow from "./anonymous-arrow";
          import buildSatisfiesArrow from "./satisfies-arrow";
          import dormantBuilder from "./dormant";
          buildNamedFunction();
          buildAnonymousFunction();
          buildNamedArrow();
          buildAnonymousArrow();
          buildSatisfiesArrow();
          console.log(dormantBuilder);
        `,
        "scripts/named-function.ts": `
          import fs from "node:fs";
          export default function buildNamedFunction() {
            fs.readFileSync("named-function/registry.json", "utf8");
          }
        `,
        "scripts/anonymous-function.ts": `
          import fs from "node:fs";
          export default function() {
            fs.readFileSync("anonymous-function/registry.json", "utf8");
          }
        `,
        "scripts/named-arrow.ts": `
          import fs from "node:fs";
          const buildNamedArrow = () => fs.readFileSync("named-arrow/registry.json", "utf8");
          export default buildNamedArrow;
        `,
        "scripts/anonymous-arrow.ts": `
          import fs from "node:fs";
          export default () => fs.readFileSync("anonymous-arrow/registry.json", "utf8");
        `,
        "scripts/satisfies-arrow.ts": `
          import fs from "node:fs";
          export default (() => fs.readFileSync("satisfies-arrow/registry.json", "utf8")) satisfies (() => string);
        `,
        "scripts/dormant.ts": `
          import fs from "node:fs";
          export default () => fs.readFileSync("dormant/registry.json", "utf8");
        `,
        "named-function/registry.json": JSON.stringify({ files: [{ path: "input.ts" }] }),
        "named-function/input.ts": "export const input = true;",
        "anonymous-function/registry.json": JSON.stringify({ files: [{ path: "input.ts" }] }),
        "anonymous-function/input.ts": "export const input = true;",
        "named-arrow/registry.json": JSON.stringify({ files: [{ path: "input.ts" }] }),
        "named-arrow/input.ts": "export const input = true;",
        "anonymous-arrow/registry.json": JSON.stringify({ files: [{ path: "input.ts" }] }),
        "anonymous-arrow/input.ts": "export const input = true;",
        "satisfies-arrow/registry.json": JSON.stringify({ files: [{ path: "input.ts" }] }),
        "satisfies-arrow/input.ts": "export const input = true;",
        "dormant/registry.json": JSON.stringify({ files: [{ path: "input.ts" }] }),
        "dormant/input.ts": "export const input = true;",
      },
      { scripts: { build: "tsx scripts/build.ts" } },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toEqual(
      expect.arrayContaining([
        "named-function/input.ts",
        "anonymous-function/input.ts",
        "named-arrow/input.ts",
        "anonymous-arrow/input.ts",
        "satisfies-arrow/input.ts",
      ]),
    );
    expect(unusedFiles).toContain("dormant/input.ts");
  });

  it("recursively expands manifest wildcards assigned inside an invoked builder", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const buildRegistry = () => {
            const registryPath = path.join(process.cwd(), "registry.json");
            const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
            const componentsToProcess = registry.components;
            for (const component of componentsToProcess) {
              for (const file of component.files) {
                if (file.path.includes("*")) {
                  const sourceBase = file.path.split("*")[0];
                  walk(sourceBase, sourceBase);
                }
              }
            }
          };
          buildRegistry();
        `,
        "registry.json": JSON.stringify({
          components: [{ files: [{ path: "templates/routes/*" }] }],
        }),
        "templates/routes/account/index.ts": "export const account = true;",
        "templates/orphan.ts": "export const orphan = true;",
      },
      { scripts: { build: "tsx scripts/build-registry.ts" } },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toContain("templates/routes/account/index.ts");
    expect(unusedFiles).toContain("templates/orphan.ts");
  });

  it("bounds recursively discovered input directories", async () => {
    const rootDirectory = createProject(
      {
        "scripts/generate-templates.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const templatesDirectory = path.join(process.cwd(), "templates");
          function walk(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
              if (entry.isDirectory()) walk(path.join(directory, entry.name));
            }
          }
          walk(templatesDirectory);
        `,
        "templates/near.ts": "export const near = true;",
        "templates/a/b/c/d/e/f/g/h/i/j/k/deep.ts": "export const deep = true;",
      },
      { scripts: { "generate:templates": "tsx scripts/generate-templates.ts" } },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toContain("templates/near.ts");
    expect(unusedFiles).toContain("templates/a/b/c/d/e/f/g/h/i/j/k/deep.ts");
  });

  it("does not consume a directory whose script only lists and filters entries", async () => {
    const rootDirectory = createProject(
      {
        "scripts/list-templates.ts": `
          import fs from "node:fs";
          function findTemplateNames(directory) {
            return fs.readdirSync(directory).filter((entry) => entry.endsWith(".ts"));
          }
          console.log(findTemplateNames("templates"));
        `,
        "templates/one.ts": "export const one = true;",
        "templates/two.ts": "export const two = true;",
      },
      { scripts: { list: "tsx scripts/list-templates.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual([
      "templates/one.ts",
      "templates/two.ts",
    ]);
  });

  it("does not exclude a registry directory without a filesystem consumer", async () => {
    const rootDirectory = createProject(
      { "src/registry/orphan.ts": "export const orphan = true;" },
      { scripts: { build: "next build" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/registry/orphan.ts"]);
  });

  it("does not treat a write-only registry path as an input", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const fileName = process.argv[2];
          fs.writeFileSync(path.join(process.cwd(), "src/registry", fileName), "output");
        `,
        "src/registry/button.tsx": "export const Button = () => null;",
      },
      { scripts: { "build:registry": "tsx scripts/build-registry.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toContain("src/registry/button.tsx");
  });

  it("does not treat a copy destination as a registry input", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const sourceFile = process.argv[2];
          const outputFile = path.join(process.cwd(), "src/registry", process.argv[3]);
          fs.copyFileSync(sourceFile, outputFile);
        `,
        "src/registry/button.tsx": "export const Button = () => null;",
      },
      { scripts: { "build:registry": "tsx scripts/build-registry.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toContain("src/registry/button.tsx");
  });

  it("keeps finite copied inputs from an invoked script without widening dormant arrays", async () => {
    const rootDirectory = createProject(
      {
        "index.js": `
          const demos = ["grid/dormant"];
          const activeDemos = ["grid/overview"];
          for (const demo of activeDemos) {
            fs.copyFileSync("./source/" + demo + "/App.jsx", "./src/App.jsx");
          }
        `,
        "source/grid/overview/App.jsx": "export const Overview = () => null;",
        "source/grid/dormant/App.jsx": "export const Dormant = () => null;",
        "src/App.jsx": "export const App = () => null;",
      },
      { scripts: { start: "node index.js" } },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toContain("source/grid/overview/App.jsx");
    expect(unusedFiles).toContain("source/grid/dormant/App.jsx");
  });

  it("does not recursively widen a manifest wildcard", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          fs.readFileSync("registry.json", "utf8");
          function walk(directory) {
            for (const entry of fs.readdirSync(directory)) walk(entry);
          }
        `,
        "registry.json": JSON.stringify({ files: [{ path: "src/templates/*.tsx" }] }),
        "src/templates/button.tsx": "export const Button = () => null;",
        "src/templates/deep/orphan.ts": "export const orphan = true;",
      },
      { scripts: { "build:registry": "tsx scripts/build-registry.ts" } },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).not.toContain("src/templates/button.tsx");
    expect(unusedFiles).toContain("src/templates/deep/orphan.ts");
  });

  it("does not infer consumers from a dormant registry script", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          fs.readFileSync("registry.json", "utf8");
        `,
        "registry.json": JSON.stringify({ files: [{ path: "src/registry/button.tsx" }] }),
        "src/registry/button.tsx": "export const Button = () => null;",
      },
      { scripts: { build: "next build" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toContain("src/registry/button.tsx");
  });

  it("keeps copy inputs scoped to live loops and syntax", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          const demos = ["active", // "commented"
          ];
          for (const demo of demos) fs.copyFileSync("./source/" + demo + "/App.jsx", "./src/App.jsx");
          function dormant() {
            const demos = ["dormant"];
            for (const demo of demos) fs.copyFileSync("./source/" + demo + "/App.jsx", "./src/App.jsx");
          }
          console.log(dormant);
        `,
        "source/active/App.jsx": "export const active = true;",
        "source/commented/App.jsx": "export const commented = true;",
        "source/dormant/App.jsx": "export const dormant = true;",
      },
      { scripts: { build: "tsx scripts/build-registry.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual([
      "source/commented/App.jsx",
      "source/dormant/App.jsx",
    ]);
  });

  it("does not execute type-only or uncalled imported helpers", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import { type Shape } from "./types";
          import { dormant } from "./helper";
          console.log(dormant);
        `,
        "scripts/types.ts": `
          import fs from "node:fs";
          fs.readFileSync("registry.json", "utf8");
          export interface Shape { value: string }
        `,
        "scripts/helper.ts": `
          import fs from "node:fs";
          export const dormant = () => fs.readFileSync("registry.json", "utf8");
        `,
        "registry.json": JSON.stringify({ files: [{ path: "src/orphan.ts" }] }),
        "src/orphan.ts": "export const orphan = true;",
      },
      { scripts: { build: "tsx scripts/build-registry.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toContain("src/orphan.ts");
  });

  it("does not derive live manifest or registry paths from comments", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const inputPath = path.join(process.cwd(),
            // "registry.json" and "src/registry"
            "package.json");
          fs.readFileSync(inputPath, "utf8");
        `,
        "registry.json": JSON.stringify({ files: [{ path: "src/registry/orphan.tsx" }] }),
        "src/registry/orphan.tsx": "export const orphan = true;",
      },
      { scripts: { build: "tsx scripts/build-registry.ts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toContain("src/registry/orphan.tsx");
  });

  it("does not widen unrelated registry metadata or wildcard flows", async () => {
    const rootDirectory = createProject(
      {
        "scripts/build-registry.ts": `
          import fs from "node:fs";
          import path from "node:path";
          import { registry, unrelated } from "../src/registry";
          import { styles } from "../src/registry/registry-styles";
          fs.readFileSync("registry.json", "utf8");
          for (const style of styles) for (const item of registry) {
            fs.readFileSync(path.join(process.cwd(), "src/registry", style.name, item.files[0].path));
          }
          for (const candidate of unrelated.files) {
            const filePathPattern = candidate.path;
            const hasWildcard = filePathPattern.includes("*");
            const sourceBase = hasWildcard ? filePathPattern.split("*")[0] : filePathPattern;
            if (hasWildcard) walk(sourceBase, sourceBase);
          }
        `,
        "registry.json": JSON.stringify({ files: [{ path: "src/templates/*.tsx" }] }),
        "src/registry/index.ts": `
          export const registry = [];
          export const unrelated = { files: [{ path: "ui/orphan.tsx" }] };
        `,
        "src/registry/registry-styles.ts": `export const styles = [{ name: "default" }];`,
        "src/registry/default/ui/orphan.tsx": "export const orphan = true;",
        "src/templates/button.tsx": "export const button = true;",
        "src/templates/deep/orphan.ts": "export const orphan = true;",
      },
      { scripts: { build: "tsx scripts/build-registry.ts" } },
    );

    const unusedFiles = await relativeUnusedFiles(rootDirectory);

    expect(unusedFiles).toContain("src/templates/deep/orphan.ts");
  });

  it("does not resolve missing workspace manifest paths from the project root", async () => {
    const rootDirectory = createProject(
      {
        "packages/application/package.json": JSON.stringify({
          scripts: { build: "tsx scripts/build-registry.ts" },
        }),
        "packages/application/scripts/build-registry.ts": `
          import fs from "node:fs";
          fs.readFileSync("registry.json", "utf8");
        `,
        "packages/application/registry.json": JSON.stringify({
          files: [{ path: "src/registry/button.tsx" }],
        }),
        "src/registry/button.tsx": "export const rootButton = true;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toContain("src/registry/button.tsx");
  });
});
