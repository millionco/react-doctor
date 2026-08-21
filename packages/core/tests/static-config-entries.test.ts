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
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-static-config-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const relativeUnusedFiles = async (
  rootDirectory: string,
  entryPatterns: string[] = [],
): Promise<string[]> => {
  const result = await analyzeProject({ rootDirectory, entryPatterns });
  return result.unusedFiles.map((finding) =>
    path.relative(rootDirectory, finding.path).replaceAll("\\", "/"),
  );
};

describe("static JavaScript config entries", () => {
  it("resolves statically bound shorthand Vite roots and Rollup inputs", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import { join } from "node:path";
          import { defineConfig } from "vite";
          const root = join(__dirname, "app");
          const input = { main: join(root, "main.html") };
          const rollupOptions = { input };
          const build = { rollupOptions };
          const config = { root, build };
          export default defineConfig(config);
        `,
        "app/main.html": `<script type="module" src="/main.ts"></script>`,
        "app/main.ts": `import { value } from "./value"; console.log(value);`,
        "app/value.ts": "export const value = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/orphan.ts"]);
  });

  it("resolves statically bound shorthand tsup and tsdown entries", async () => {
    const rootDirectory = createProject(
      {
        "tsup.config.ts": `
          import { defineConfig } from "tsup";
          const entry = ["./src/tsup-entry.ts"];
          const config = { entry };
          export default defineConfig(config);
        `,
        "tsdown.config.ts": `
          import { defineConfig } from "tsdown";
          const entry = { cli: "./src/tsdown-entry.ts" };
          export default defineConfig({ entry });
        `,
        "src/tsup-entry.ts": "export const tsupEntry = 1;",
        "src/tsdown-entry.ts": "export const tsdownEntry = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { tsup: "1.0.0", tsdown: "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/orphan.ts"]);
  });

  it("resolves statically bound Jest matches and setup files", async () => {
    const rootDirectory = createProject(
      {
        "jest.config.ts": `
          const testMatch = ["**/*.custom.ts"];
          const setupFilesAfterEnv = ["./src/jest-setup.ts"];
          const config = { testMatch, setupFilesAfterEnv };
          export default config;
        `,
        "src/example.custom.ts": `import { helper } from "./helper"; console.log(helper);`,
        "src/helper.ts": "export const helper = 1;",
        "src/jest-setup.ts": "globalThis.setup = true;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { jest: "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/orphan.ts"]);
  });

  it("resolves statically bound Vitest includes and setup files", async () => {
    const rootDirectory = createProject(
      {
        "vitest.config.ts": `
          import { defineConfig } from "vitest/config";
          const include = ["src/**/*.check.ts"];
          const setupFiles = ["./src/vitest-setup.ts"];
          const test = { include, setupFiles };
          export default defineConfig({ test });
        `,
        "src/example.check.ts": `import { helper } from "./helper"; console.log(helper);`,
        "src/helper.ts": "export const helper = 1;",
        "src/vitest-setup.ts": "globalThis.setup = true;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vitest: "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory)).toEqual(["src/orphan.ts"]);
  });

  it("resolves statically bound GraphQL codegen inputs and outputs", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `
          const generates = { "./src/generated.ts": { plugins: ["typescript"] } };
          const documents = ["./src/documents/**/*.ts"];
          const schema = "./src/schema.ts";
          const config = { generates, documents, schema };
          export default config;
        `,
        "src/index.ts": "console.log('app');",
        "src/generated.ts": "export interface GeneratedShape { value: string }",
        "src/documents/query.ts": `import { documentHelper } from "../document-helper"; console.log(documentHelper);`,
        "src/document-helper.ts": "export const documentHelper = 1;",
        "src/schema.ts": `import { schemaHelper } from "./schema-helper"; console.log(schemaHelper);`,
        "src/schema-helper.ts": "export const schemaHelper = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { "@graphql-codegen/cli": "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory, ["src/index.ts"])).toEqual([
      "src/document-helper.ts",
      "src/orphan.ts",
    ]);
  });

  it("resolves statically bound GraphQL codegen Vite plugin options", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import graphqlCodegen from "vite-plugin-graphql-codegen";
          const generates = { "./src/generated.ts": {} };
          const codegenConfig = { generates };
          const plugins = [graphqlCodegen(codegenConfig)];
          export default { plugins };
        `,
        "src/index.ts": "console.log('app');",
        "src/generated.ts": "export interface GeneratedShape { value: string }",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { "vite-plugin-graphql-codegen": "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory, ["src/index.ts"])).toEqual(["src/orphan.ts"]);
  });

  it("ignores statically bound GraphQL codegen objects that are not exported", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `
          const generates = { "./src/manual.ts": {} };
          console.log(generates);
          export default {};
        `,
        "src/index.ts": "console.log('app');",
        "src/manual.ts": "export const manual = 1;",
      },
      { devDependencies: { "@graphql-codegen/cli": "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory, ["src/index.ts"])).toEqual(["src/manual.ts"]);
  });

  it("resolves GraphQL codegen YAML anchors, flow maps, and object-map inputs", async () => {
    const rootDirectory = createProject(
      {
        "codegen.yml": `
          shared: &shared
            documents: { "./src/documents/**/*.ts": { noRequire: true } }
            schema: ["https://example.com/graphql", "./src/schema.ts"]
          generates: { "./src/generated.ts": { <<: *shared } }
        `,
        "src/index.ts": "console.log('app');",
        "src/generated.ts": "export interface GeneratedShape { value: string }",
        "src/documents/query.ts": "export const query = 1;",
        "src/schema.ts": "export const schema = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { "@graphql-codegen/cli": "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory, ["src/index.ts"])).toEqual(["src/orphan.ts"]);
  });

  it("preserves URL-bearing GraphQL codegen JSON strings", async () => {
    const rootDirectory = createProject(
      {
        ".graphqlrc.json": JSON.stringify({
          schema: "https://example.com/graphql",
          documents: { "./src/documents/**/*.ts": {} },
          generates: { "./src/generated.ts": {} },
        }),
        "src/index.ts": "console.log('app');",
        "src/generated.ts": "export interface GeneratedShape { value: string }",
        "src/documents/query.ts": "export const query = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { "@graphql-codegen/cli": "1.0.0" } },
    );

    expect(await relativeUnusedFiles(rootDirectory, ["src/index.ts"])).toEqual(["src/orphan.ts"]);
  });
});
