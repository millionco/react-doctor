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
  it("keeps registry source and generated files used by an invoked registry builder", async () => {
    const rootDirectory = createProject(
      {
        "src/scripts/build-registry.mts": `
          import fs from "node:fs";
          import path from "node:path";
          const source = path.join(process.cwd(), "src/registry", style, file.path);
          fs.readFileSync(source, "utf8");
          const output = \`src/__registry__/\${style}/\${file.path}\`;
          fs.writeFileSync(path.join(process.cwd(), output), "generated");
        `,
        "src/registry/default/button.tsx": "export const Button = () => null;",
        "src/__registry__/default/button.tsx": "export const Button = () => null;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { scripts: { "build:registry": "tsx src/scripts/build-registry.mts" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/orphan.ts"]);
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

  it("keeps a recursive generator input directory without excluding unrelated directories", async () => {
    const rootDirectory = createProject(
      {
        "scripts/generate-plugins.ts": `
          import fs from "node:fs";
          import path from "node:path";
          const extrasDirectory = path.join(__dirname, "../extras");
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
});
