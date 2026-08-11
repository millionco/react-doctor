import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
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
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-project-analysis-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const relativePath = (rootDirectory: string, filePath: string): string =>
  path.relative(rootDirectory, filePath).replaceAll("\\", "/");

const relativePaths = (
  rootDirectory: string,
  findings: ReadonlyArray<{ readonly path: string }>,
): string[] => findings.map((finding) => relativePath(rootDirectory, finding.path));

describe("analyzeProject", () => {
  it("reports all six graph diagnostics, including unused type exports", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import usedPackage from "used-package";
          import { liveValue } from "./library";
          import { cycleA } from "./cycle-a";
          console.log(usedPackage, liveValue, cycleA);
        `,
        "src/library.ts": `
          export const liveValue = 1;
          export const unusedValue = 2;
          export interface UnusedShape { value: string }
        `,
        "src/orphan.ts": "export const orphan = true;",
        "src/cycle-a.ts": `
          import { cycleB } from "./cycle-b";
          export const cycleA = cycleB + 1;
        `,
        "src/cycle-b.ts": `
          import { cycleA } from "./cycle-a";
          export const cycleB = cycleA + 1;
        `,
      },
      {
        dependencies: { "used-package": "1.0.0", "unused-package": "1.0.0" },
        devDependencies: { "unused-dev-package": "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/orphan.ts");
    expect(result.unusedExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "unusedValue", isTypeOnly: false }),
        expect.objectContaining({ name: "UnusedShape", isTypeOnly: true }),
      ]),
    );
    expect(result.unusedDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "unused-package", isDevDependency: false }),
        expect.objectContaining({ name: "unused-dev-package", isDevDependency: true }),
      ]),
    );
    expect(result.circularDependencies).toEqual([
      expect.objectContaining({
        files: expect.any(Array),
      }),
    ]);
    expect(
      result.circularDependencies[0]?.files.map((filePath) =>
        relativePath(rootDirectory, filePath),
      ),
    ).toEqual(expect.arrayContaining(["src/cycle-a.ts", "src/cycle-b.ts"]));
  });

  it("tracks namespace members without treating type-only edges as runtime cycles", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import * as library from "./library";
          import type { TypeA } from "./type-a";
          const value: TypeA | undefined = undefined;
          console.log(library.used, value);
        `,
        "src/library.ts": `
          export const used = 1;
          export const unused = 2;
        `,
        "src/type-a.ts": `
          import type { TypeB } from "./type-b";
          export interface TypeA { child: TypeB }
        `,
        "src/type-b.ts": `
          import type { TypeA } from "./type-a";
          export interface TypeB { parent: TypeA }
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedExports).toEqual([
      expect.objectContaining({ name: "unused", isTypeOnly: false }),
    ]);
    expect(result.circularDependencies).toEqual([]);
  });

  it("does not treat type-only re-exports as runtime cycle edges", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          export const registry = 1;
          export type { Handler } from "./handler";
          export { type HandlerOptions } from "./handler";
        `,
        "src/handler.ts": `
          import { registry } from "./index";
          export interface Handler { registry: typeof registry }
          export interface HandlerOptions { enabled: boolean }
          export const registeredValue = registry;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([]);
  });

  it("keeps a mixed value and type re-export edge in runtime cycles", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          export const registry = 1;
          export { registeredValue, type Handler } from "./handler";
        `,
        "src/handler.ts": `
          import { registry } from "./index";
          export interface Handler { registry: typeof registry }
          export const registeredValue = registry;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toHaveLength(1);
  });

  it("reports cycles formed by side-effect imports", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": 'import "./cycle-a";',
        "src/cycle-a.ts": 'import "./cycle-b";',
        "src/cycle-b.ts": 'import "./cycle-a";',
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([
      expect.objectContaining({
        files: expect.any(Array),
      }),
    ]);
    expect(
      result.circularDependencies[0]?.files.map((filePath) =>
        relativePath(rootDirectory, filePath),
      ),
    ).toEqual(expect.arrayContaining(["src/cycle-a.ts", "src/cycle-b.ts"]));
  });

  it("links named, default, namespace, dynamic, and chained re-exports", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import defaultValue, { namedValue } from "./barrel";
          import * as namespace from "./namespace";
          void import("./dynamic").then((module) => module.dynamicValue);
          console.log(defaultValue, namedValue, namespace.usedValue);
        `,
        "src/barrel.ts": `
          export { default, namedValue, unusedValue } from "./leaf";
        `,
        "src/leaf.ts": `
          export default 1;
          export const namedValue = 2;
          export const unusedValue = 3;
        `,
        "src/namespace.ts": `
          export const usedValue = 1;
          export const unusedNamespaceValue = 2;
        `,
        "src/dynamic.ts": `
          export const dynamicValue = 1;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);
    const unusedExportNames = result.unusedExports.map((unusedExport) => unusedExport.name);

    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining([
        "src/barrel.ts",
        "src/leaf.ts",
        "src/namespace.ts",
        "src/dynamic.ts",
      ]),
    );
    expect(unusedExportNames).toEqual(
      expect.arrayContaining(["unusedValue", "unusedNamespaceValue"]),
    );
    expect(unusedExportNames).not.toEqual(
      expect.arrayContaining(["default", "namedValue", "usedValue", "dynamicValue"]),
    );
  });

  it("resolves tsconfig path aliases", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import { aliasedValue } from "@app/value";
          console.log(aliasedValue);
        `,
        "src/lib/value.ts": "export const aliasedValue = 1;",
        "src/lib/orphan.ts": "export const orphan = 1;",
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/lib/*"] } },
        }),
      },
      {},
    );

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/index.ts"],
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/lib/orphan.ts");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/lib/value.ts");
  });

  it("discovers config and test entries without explicit patterns", async () => {
    const rootDirectory = createProject(
      {
        "src/main.ts": "console.log('app');",
        "src/vite-plugin.ts": "export const plugin = {};",
        "src/test-helper.ts": "export const helper = 1;",
        "src/orphan.ts": "export const orphan = 1;",
        "vite.config.ts": `
          import { plugin } from "./src/vite-plugin";
          export default { plugins: [plugin] };
        `,
        "tests/app.test.ts": `
          import { helper } from "../src/test-helper";
          console.log(helper);
        `,
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/vite-plugin.ts", "src/test-helper.ts"]),
    );
  });

  it("discovers framework route entries", async () => {
    const rootDirectory = createProject(
      {
        "src/pages/index.tsx": `
          import { pageValue } from "../page-value";
          export default () => <main>{pageValue}</main>;
        `,
        "src/page-value.ts": "export const pageValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { next: "1.0.0", react: "1.0.0", "react-dom": "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toContain("src/page-value.ts");
  });

  it.each([
    { frameworkDependency: "umi", routeConfigPath: "config/routes.ts" },
    { frameworkDependency: "@umijs/max", routeConfigPath: "config/routes.simple.ts" },
  ])(
    "discovers $frameworkDependency application and route convention entries",
    async ({ frameworkDependency, routeConfigPath }) => {
      const rootDirectory = createProject(
        {
          "config/config.ts": `export default { title: "application" };`,
          "config/config.dev.ts": `import { configValue } from "../src/config-value"; export default { configValue };`,
          [routeConfigPath]: `import { routeValue } from "../src/route-value"; export default [{ path: "/", component: routeValue }];`,
          "src/app.tsx": `import { appValue } from "./app-value"; export const render = () => appValue;`,
          "src/app-value.ts": "export const appValue = 1;",
          "src/config-value.ts": "export const configValue = 1;",
          "src/locales/en-US.ts": `import { localeValue } from "../locale-value"; export default localeValue;`,
          "src/locale-value.ts": "export const localeValue = { title: 'application' };",
          "src/pages/index.tsx": `import { pageValue } from "../page-value"; export default () => <main>{pageValue}</main>;`,
          "src/page-value.ts": "export const pageValue = 1;",
          "src/route-value.ts": "export const routeValue = '@/pages/index';",
          "src/orphan.ts": "export const orphan = 1;",
        },
        { dependencies: { [frameworkDependency]: "1.0.0", react: "1.0.0" } },
      );

      const result = await analyzeProject({ rootDirectory });

      expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
    },
  );

  it("discovers Taro application, config, and page convention entries", async () => {
    const rootDirectory = createProject(
      {
        "config/index.ts": `import developmentConfig from "./dev"; export default developmentConfig;`,
        "config/dev.ts": "export default { env: 'development' };",
        "src/app.tsx": `import { appValue } from "./app-value"; export default () => appValue;`,
        "src/app.config.ts": `
          export default defineAppConfig({
            pages: ["pages/home/index"],
            subPackages: [{ root: "package-a", pages: ["profile/index"] }],
          });
        `,
        "src/app-value.ts": "export const appValue = 1;",
        "src/pages/home/index.tsx": `import { pageValue } from "../../lib/page-value"; export default () => <main>{pageValue}</main>;`,
        "src/pages/home/old-unused.ts": "export const oldUnused = 1;",
        "src/package-a/profile/index.tsx": "export default () => <main>Profile</main>;",
        "src/package-a/profile/old-unused.ts": "export const oldUnused = 1;",
        "src/lib/page-value.ts": "export const pageValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {
        dependencies: {
          "@tarojs/cli": "1.0.0",
          "@tarojs/react": "1.0.0",
          "@tarojs/runtime": "1.0.0",
          react: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/orphan.ts",
      "src/package-a/profile/old-unused.ts",
      "src/pages/home/old-unused.ts",
    ]);
  });

  it("discovers Taro pages from identifier-bound application config", async () => {
    const rootDirectory = createProject(
      {
        "src/app.tsx": "export default () => null;",
        "src/app.config.ts": `
          const appConfig = defineAppConfig({ pages: ["pages/home/index"] });
          export default appConfig;
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("discovers Remix routes from a custom app directory", async () => {
    const rootDirectory = createProject(
      {
        "remix.config.js": `module.exports = { appDirectory: "src" };`,
        "src/root.tsx": `import { routeValue } from "./routes/index"; export default () => <main>{routeValue}</main>;`,
        "src/routes/index.tsx": "export const routeValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { "@remix-run/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/root.tsx", "src/routes/index.tsx"]),
    );
  });

  it("discovers GraphQL codegen inputs", async () => {
    const rootDirectory = createProject(
      {
        "codegen-main.ts": `
          export default {
            schema: "./schema.graphql",
            // documents: ["./src/commented.ts"],
            documents: ["./src/**/queries.ts", "!./src/legacy/**"],
          };
        `,
        "schema.graphql": "type Query { value: String }",
        "src/commented.ts": "export const commented = true;",
        "src/feature/queries.ts": `import { helper } from "../helper"; export const query = \`query { value }\`; console.log(helper);`,
        "src/helper.ts": "export const helper = 1;",
        "src/legacy/queries.ts": "export const legacyQuery = `query { value }`;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/legacy/queries.ts");
    expect(unusedFilePaths).toContain("src/commented.ts");
    expect(unusedFilePaths).toContain("src/helper.ts");
    expect(unusedFilePaths).not.toContain("src/feature/queries.ts");
    expect(result.unusedExports).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "query" })]),
    );
  });

  it("discovers YAML block-list codegen inputs without activating comments", async () => {
    const rootDirectory = createProject(
      {
        "codegen.yml": `
          schema:
            - "./src/schema-loader.ts"
          documents:
            - "./src/documents/**/*.ts" # active documents
            - "!./src/documents/excluded/**"
            # - "./src/commented-list-item/**/*.ts"
          # documents:
          #   - "./src/commented-property/**/*.ts"
        `,
        "src/schema-loader.ts": `import { schemaHelper } from "./schema-helper"; export default schemaHelper;`,
        "src/schema-helper.ts": "export const schemaHelper = {};",
        "src/documents/query.ts": `import { documentHelper } from "../document-helper"; export const query = \`query { value }\`; console.log(documentHelper);`,
        "src/document-helper.ts": "export const documentHelper = 1;",
        "src/documents/excluded/legacy.ts": "export const legacyQuery = `query { legacy }`;",
        "src/commented-list-item/query.ts": "export const commentedListItemQuery = 1;",
        "src/commented-property/query.ts": "export const commentedPropertyQuery = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/schema-loader.ts", "src/schema-helper.ts"]),
    );
    expect(unusedFilePaths).not.toContain("src/documents/query.ts");
    expect(unusedFilePaths).toEqual(
      expect.arrayContaining([
        "src/document-helper.ts",
        "src/documents/excluded/legacy.ts",
        "src/commented-list-item/query.ts",
        "src/commented-property/query.ts",
      ]),
    );
    expect(result.unusedExports).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "query" })]),
    );
  });

  it("keeps GraphQL codegen outputs in the graph without reporting them", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `
          export default {
            schema: "./schema.graphql",
            generates: {
              "./src/api-types.ts": { plugins: ["typescript"] },
            },
          };
        `,
        "schema.graphql": "type Query { value: String }",
        "src/index.ts": `import { usedType } from "./api-types"; console.log(usedType);`,
        "src/api-types.ts": `export const usedType = 1; export interface GeneratedShape { value: string }`,
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
    expect(result.unusedExports).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "GeneratedShape" })]),
    );
  });

  it("discovers GraphQL codegen outputs from one-line JavaScript objects", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `export default { generates: { /* output map { */ "./src/api-runtime.ts": { config: { "./src/not-an-output.ts": true }, plugins: ["typescript"] } } };`,
        "src/index.ts": "console.log('app');",
        "src/api-runtime.ts": "export const apiRuntime = 1;",
        "src/not-an-output.ts": "export const notAnOutput = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/not-an-output.ts",
      "src/orphan.ts",
    ]);
  });

  it("does not discover GraphQL codegen outputs from strings or comments", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `
          const example = 'generates: { "./src/string-decoy.ts": {} }';
          const enabled = true; // generates: { "./src/comment-decoy.ts": {} }
          export default { generates: { "./src/api-runtime.ts": {} } };
        `,
        "src/index.ts": "console.log('app');",
        "src/api-runtime.ts": "export const apiRuntime = 1;",
        "src/string-decoy.ts": "export const stringDecoy = 1;",
        "src/comment-decoy.ts": "export const commentDecoy = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/comment-decoy.ts",
      "src/orphan.ts",
      "src/string-decoy.ts",
    ]);
  });

  it("suppresses provenance-backed outputs without inferring generation from type shapes", async () => {
    const rootDirectory = createProject(
      {
        "codegen.yml": `
          schema: schema.graphql
          generates:
            src/api-client.ts:
              plugins:
                - typescript
        `,
        "schema.graphql": "type Query { value: String }",
        "src/index.ts": "console.log('app');",
        "src/generated/schema.ts": "export interface GeneratedDirectoryShape { value: string }",
        "src/schema.generated.ts": "export interface GeneratedFilenameShape { value: string }",
        "src/protocol.ts":
          "// @generated by protocol compiler\nexport interface GeneratedHeaderShape { value: string }",
        "src/graphql-types.ts":
          "export type Maybe<T> = T | null; export type Exact<T> = T; export interface GeneratedGraphqlShape { value: string }",
        "src/apollo-types.ts":
          "export type QueryKeySpecifier = ['query']; export type QueryFieldPolicy = { read(): unknown };",
        "src/protocol.h.ts": "export interface HandWrittenProtocol { value: string }",
        "src/late-generated-marker.ts":
          "export const handWritten = true;\n// This example was generated by a test helper.",
        "src/do-not-edit.ts":
          "// Do not edit this file directly; use the admin UI.\nexport const handWritten = true;",
        "src/api-client.ts": "export interface GeneratedConfigShape { value: string }",
        "src/__testfixtures__/parser-output.ts": "export const fixture = 1;",
        "src/vendor/library.ts": "export const vendored = 1;",
        "src/assets/libs/runtime.ts": "export const staticRuntime = 1;",
        "src/button.figma.tsx": "export const codeConnectExample = 1;",
        "public/runtime.ts": "export const publicRuntime = 1;",
        "src/public/manual.ts": "export const manuallyOwned = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/apollo-types.ts",
      "src/do-not-edit.ts",
      "src/graphql-types.ts",
      "src/late-generated-marker.ts",
      "src/orphan.ts",
      "src/protocol.h.ts",
      "src/public/manual.ts",
    ]);
    expect(result.unusedExports).toEqual([]);
  });

  it("resolves Vite HTML entries from the configured root", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.mts": `
          import { join } from "node:path";
          const rendererRoot = join(__dirname, "src", "renderer");
          export default {
            root: rendererRoot,
            build: { rollupOptions: { input: { search: join(rendererRoot, "search.html") } } },
          };
        `,
        "src/renderer/search.html": `<script type="module" src="/search.tsx"></script>`,
        "src/renderer/search.tsx": `import { Search } from "./search"; console.log(Search);`,
        "src/renderer/search.ts": "export const Search = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("uses only the top-level Vite root and resolves direct path calls", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import { resolve } from "node:path";
          // root: "./wrong-root",
          export default {
            plugins: [{ options: { root: "./wrong-root" } }],
            root: resolve(__dirname, "src", "renderer"),
          };
        `,
        "src/renderer/index.html": `<script type="module" src="/main.ts"></script>`,
        "src/renderer/main.ts": `import { application } from "./application"; console.log(application);`,
        "src/renderer/application.ts": "export const application = 1;",
        "wrong-root/index.html": `<script type="module" src="/unused.ts"></script>`,
        "wrong-root/unused.ts": "export const unused = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("wrong-root/unused.ts");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toEqual(
      expect.arrayContaining(["src/renderer/main.ts", "src/renderer/application.ts"]),
    );
  });

  it("discovers Electron Forge renderer entry points", async () => {
    const rootDirectory = createProject(
      {
        "forge.config.ts": `
          export default {
            plugins: [{ renderer: { entryPoints: [{
              html: "./src/renderer/index.html",
              js: "./src/renderer/index.tsx",
              preload: { js: "./src/preload.ts" },
            }] } }],
          };
        `,
        "src/renderer/index.html": "<main></main>",
        "src/renderer/index.tsx": `import { application } from "./application"; console.log(application);`,
        "src/renderer/application.ts": "export const application = 1;",
        "src/preload.ts": "console.log('preload');",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { "@electron-forge/cli": "1.0.0", electron: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("discovers Vitest includes declared in Vite config", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          export default {
            test: {
              include: ["**/*_{test,spec}.?(c|m)[jt]s?(x)"],
              coverage: { include: ["src/**"] },
            },
          };
        `,
        "test/component_test.tsx": `import { component } from "../src/component"; console.log(component);`,
        "src/component.ts": "export const component = 1;",
        "src/coverage-only.ts": "export const coverageOnly = 1;",
      },
      { devDependencies: { vitest: "1.0.0", vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/coverage-only.ts"]);
  });

  it("discovers Vitest includes after astral Unicode", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          const label = "😀";
          export default { test: { include: ["cases/**/*.case.ts"] } };
        `,
        "src/index.ts": "console.log('app');",
        "cases/actual.case.ts": "export const actualCase = true;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("does not treat the array after a Vitest include variable as the include value", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          const testFiles = ["test/**/*.case.ts"];
          export default {
            test: {
              include: testFiles,
              exclude: ["src/ignored.ts"],
            },
          };
        `,
        "src/index.ts": "console.log('app');",
        "src/ignored.ts": "export const ignored = 1;",
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/ignored.ts"]);
  });

  it("does not treat Vite plugin include filters as Vitest entries", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          /* test: { */
          export default {
            plugins: [{ include: ["src/plugin-filtered.ts"] }],
          };
        `,
        "src/index.ts": "console.log('app');",
        "src/plugin-filtered.ts": "export const pluginFiltered = 1;",
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/plugin-filtered.ts"]);
  });

  it("discovers externally consumed component composition registries", async () => {
    const rootDirectory = createProject(
      { "src/composition.tsx": "export const Composition = () => <main />;" },
      {
        private: "true",
        description: "Registry for component compositions",
        dependencies: { react: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/composition.tsx");
  });

  it("resolves composition registry entries relative to a workspace package", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const root = 1;",
        "packages/compositions/package.json": JSON.stringify({
          name: "@example/compositions",
          private: true,
          description: "Registry for component compositions",
        }),
        "packages/compositions/src/composition.tsx": "export const Composition = () => <main />;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "packages/compositions/src/composition.tsx",
    );
  });

  it("credits packages referenced by scripts, config, and CI workflows", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "vite.config.ts": `import configPackage from "config-package"; export default configPackage;`,
        ".github/workflows/release.yml": `steps:\n  - run: npx ci-package deploy`,
      },
      {
        scripts: { build: "script-package build" },
        devDependencies: {
          "script-package": "1.0.0",
          "config-package": "1.0.0",
          "ci-package": "1.0.0",
          "unused-package": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("unused-package");
    expect(unusedPackageNames).not.toEqual(
      expect.arrayContaining(["script-package", "config-package", "ci-package"]),
    );
  });

  it("credits framework-owned image and MDX dependencies", async () => {
    const rootDirectory = createProject(
      { "src/index.tsx": "export default () => <main />;" },
      {
        dependencies: {
          react: "1.0.0",
          next: "1.0.0",
          sharp: "1.0.0",
          "@next/mdx": "1.0.0",
          "@mdx-js/loader": "1.0.0",
          "@mdx-js/react": "1.0.0",
          remix: "1.0.0",
          "@remix-run/react": "1.0.0",
          "web-vitals": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.tsx"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("web-vitals");
    expect(unusedPackageNames).not.toEqual(
      expect.arrayContaining(["sharp", "@mdx-js/loader", "@mdx-js/react", "@remix-run/react"]),
    );
  });

  it("credits sharp conservatively when Next image optimization is configured", async () => {
    const rootDirectory = createProject(
      {
        "src/index.tsx": "export default () => <main />;",
        "next.config.js": "module.exports = { images: { unoptimized: true } };",
      },
      { dependencies: { react: "1.0.0", next: "1.0.0", sharp: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.tsx"] });

    expect(result.unusedDependencies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sharp" })]),
    );
  });

  it("credits the Docusaurus MDX runtime", async () => {
    const rootDirectory = createProject(
      { "src/index.tsx": "export default () => <main />;" },
      {
        dependencies: {
          react: "1.0.0",
          "@docusaurus/core": "1.0.0",
          "@mdx-js/react": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.tsx"] });

    expect(result.unusedDependencies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "@mdx-js/react" })]),
    );
  });

  it("credits known binary aliases, release config plugins, and wrapper peers", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import Chart from "react-apexcharts"; console.log(Chart);`,
        ".releaserc.json": JSON.stringify({ plugins: ["release-plugin"] }),
      },
      {
        scripts: { build: "babel src --out-dir dist", start: "remix-serve build" },
        release: { plugins: ["release-package-json-plugin"] },
        dependencies: {
          "react-apexcharts": "1.0.0",
          apexcharts: "1.0.0",
        },
        devDependencies: {
          "@babel/cli": "1.0.0",
          "@remix-run/serve": "1.0.0",
          "release-plugin": "1.0.0",
          "release-package-json-plugin": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    for (const usedPackageName of [
      "apexcharts",
      "@babel/cli",
      "@remix-run/serve",
      "release-plugin",
      "release-package-json-plugin",
    ]) {
      expect(unusedPackageNames).not.toContain(usedPackageName);
    }
  });

  it("credits packages named by tool config surfaces", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        ".stylelintrc.json": JSON.stringify({
          plugins: ["stylelint-order", "stylelint-prettier"],
        }),
        "typedoc.json": JSON.stringify({ plugin: ["typedoc-plugin-markdown"] }),
        "netlify.toml": '[[plugins]]\npackage = "@netlify/plugin-nextjs"',
        ".release-it.json": JSON.stringify({
          plugins: { "@release-it/conventional-changelog": {} },
        }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { plugins: [{ name: "typescript-plugin-css-modules" }] },
        }),
        "styles/globals.css": '@plugin "tailwindcss-animate";',
      },
      {
        "pre-commit": ["lint"],
        devDependencies: {
          "stylelint-order": "1.0.0",
          "stylelint-prettier": "1.0.0",
          "typedoc-plugin-markdown": "1.0.0",
          "@netlify/plugin-nextjs": "1.0.0",
          "typescript-plugin-css-modules": "1.0.0",
          "tailwindcss-animate": "1.0.0",
          "@release-it/conventional-changelog": "1.0.0",
          "pre-commit": "1.0.0",
          "release-it": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual([]);
  });

  it("credits package.json tool owner sections", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        "pre-commit": ["lint"],
        "release-it": {},
        devDependencies: {
          "pre-commit": "1.0.0",
          "release-it": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedDependencies).toEqual([]);
  });

  it("credits stylesheet package directives without matching ordinary stylesheet text", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "styles/globals.scss": `
          /* @plugin "commented-package"; */
          @plugin "tailwindcss-animate";
          @import url(modern-normalize/modern-normalize.css);
          @use "pkg:sass-mq";
          $color: red;
          .swiper-slide { color: $color; }
          .example::before { content: '@plugin "string-package"'; }
        `,
      },
      {
        devDependencies: {
          color: "1.0.0",
          "commented-package": "1.0.0",
          "modern-normalize": "1.0.0",
          "sass-mq": "1.0.0",
          "string-package": "1.0.0",
          swiper: "1.0.0",
          "tailwindcss-animate": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies
      .map((dependency) => dependency.name)
      .sort();

    expect(unusedPackageNames).toEqual(["color", "commented-package", "string-package", "swiper"]);
  });

  it("credits script-implied tools and binary aliases", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: {
          check: "astro check && oxlint --type-aware",
          postinstall: "patch-package",
          email: "email dev",
          serve: "react-router-serve build/server/index.js",
          deploy: 'sh -c "npx cross-env NODE_ENV=production env -u DEBUG firebase deploy"',
          publish: "rc-np",
          rebuild: "electron-rebuild",
          extract: "api-extractor run",
          taro: "taro build",
          chakra: 'bash -lc "chakra tokens src/theme.ts"',
          flow: "flow status",
          parcel: "parcel src/index.html",
          babel: "cross-env BABEL_ENV=production babel src --out-dir dist",
          "babel-node": 'nodemon --exec "babel-node --inspect" server.js',
          coverage: "node node_modules/coveralls/bin/coveralls.js",
        },
        devDependencies: {
          "@astrojs/check": "1.0.0",
          "oxlint-tsgolint": "1.0.0",
          "postinstall-postinstall": "1.0.0",
          "react-email": "1.0.0",
          "@react-router/serve": "1.0.0",
          "firebase-tools": "1.0.0",
          "@rc-component/np": "1.0.0",
          "@electron/rebuild": "1.0.0",
          "@microsoft/api-extractor": "1.0.0",
          "@tarojs/cli": "1.0.0",
          "@chakra-ui/cli": "1.0.0",
          "flow-bin": "1.0.0",
          "parcel-bundler": "1.0.0",
          "babel-cli": "1.0.0",
          coveralls: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual([]);
  });

  it.each([
    "npm exec -- firebase deploy",
    "pnpm exec firebase deploy",
    "yarn exec firebase deploy",
    "pnpm dlx firebase-tools deploy",
    "yarn dlx firebase-tools deploy",
  ])("credits binaries invoked through package-manager runners: $command", async (command) => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: { deploy: command },
        devDependencies: { "firebase-tools": "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedDependencies).toEqual([]);
  });

  it("skips ambiguous static binary providers", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: { build: "babel src --out-dir dist" },
        devDependencies: {
          "@babel/cli": "1.0.0",
          "babel-cli": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    expect(result.unusedDependencies).toEqual([]);
  });

  it("requires a complete node_modules binary name match", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: {
          coverage: "node node_modules/coveralls/bin/coveralls.js",
          tool: "node node_modules/.bin/foobar",
        },
        devDependencies: {
          coveralls: "1.0.0",
          foo: "1.0.0",
          foobar: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["foo"]);
  });

  it("credits used wrappers' required peer packages", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import prettyCode from "rehype-pretty-code";
          import { PrismaClient } from "@prisma/client";
          import ReactRefreshWebpackPlugin from "@pmmmwh/react-refresh-webpack-plugin";
          import { Elements } from "@stripe/react-stripe-js";
          console.log(prettyCode, PrismaClient, ReactRefreshWebpackPlugin, Elements);
        `,
        "prisma/schema.prisma": `generator client { provider = "prisma-client-js" }`,
      },
      {
        dependencies: {
          "rehype-pretty-code": "1.0.0",
          shiki: "1.0.0",
          "@prisma/client": "1.0.0",
          prisma: "1.0.0",
          "@pmmmwh/react-refresh-webpack-plugin": "1.0.0",
          "react-refresh": "1.0.0",
          "@stripe/react-stripe-js": "1.0.0",
          "@stripe/stripe-js": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    for (const usedPackageName of ["shiki", "prisma", "react-refresh", "@stripe/stripe-js"]) {
      expect(unusedPackageNames).not.toContain(usedPackageName);
    }
  });

  it("does not infer Prisma CLI use from the optional client peer alone", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import { PrismaClient } from "@prisma/client"; console.log(PrismaClient);`,
        "node_modules/@prisma/client/package.json": JSON.stringify({
          name: "@prisma/client",
          peerDependencies: { prisma: "*" },
          peerDependenciesMeta: { prisma: { optional: true } },
        }),
      },
      {
        dependencies: {
          "@prisma/client": "1.0.0",
          prisma: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["prisma"]);
  });

  it("does not infer Prisma CLI use from fixture schemas", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import { PrismaClient } from "@prisma/client"; console.log(PrismaClient);`,
        "test/fixtures/prisma/schema.prisma": `generator client { provider = "prisma-client-js" }`,
      },
      {
        dependencies: {
          "@prisma/client": "1.0.0",
          prisma: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["prisma"]);
  });

  it("credits native Capacitor platforms and the selected Sass compiler", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/theme.scss": "$color: red;",
        "capacitor.config.ts": "export default {};",
        "android/.gitkeep": "",
        "ios/.gitkeep": "",
      },
      {
        scripts: { build: "vite build" },
        dependencies: {
          "@capacitor/core": "1.0.0",
          "@capacitor/android": "1.0.0",
          "@capacitor/ios": "1.0.0",
          vite: "1.0.0",
          "sass-embedded": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    for (const usedPackageName of ["@capacitor/android", "@capacitor/ios", "sass-embedded"]) {
      expect(unusedPackageNames).not.toContain(usedPackageName);
    }
  });

  it("uses Sass Embedded before Sass when an observed host can compile Sass", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import "./theme.scss";`,
        "src/theme.scss": "$color: red;",
      },
      {
        scripts: { build: "vite build" },
        devDependencies: {
          sass: "1.0.0",
          "sass-embedded": "1.0.0",
          vite: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("sass");
    expect(unusedPackageNames).not.toContain("sass-embedded");
  });

  it("credits Sass when it is the installed compiler for an observed host", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import "./theme.scss";`,
        "src/theme.scss": "$color: red;",
      },
      {
        scripts: { build: "vite build" },
        devDependencies: { sass: "1.0.0", vite: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).not.toContain("sass");
  });

  it("does not infer Capacitor or Sass compiler use from declarations and stale paths", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/theme.scss": "$color: red;",
        "android/.gitkeep": "",
        "ios/.gitkeep": "",
      },
      {
        dependencies: {
          "@capacitor/core": "1.0.0",
          "@capacitor/android": "1.0.0",
          "@capacitor/ios": "1.0.0",
          vite: "1.0.0",
          "sass-embedded": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(
      expect.arrayContaining(["@capacitor/android", "@capacitor/ios", "sass-embedded"]),
    );
  });

  it("does not credit convention packages without their activation signal", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: { lint: "oxlint" },
        dependencies: {
          "postinstall-postinstall": "1.0.0",
          "@astrojs/check": "1.0.0",
          "oxlint-tsgolint": "1.0.0",
          "@capacitor/core": "1.0.0",
          "@capacitor/android": "1.0.0",
          vite: "1.0.0",
          "sass-embedded": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(
      expect.arrayContaining([
        "postinstall-postinstall",
        "@astrojs/check",
        "oxlint-tsgolint",
        "@capacitor/android",
        "sass-embedded",
      ]),
    );
  });

  it("credits required installed peers but treats installed binaries as an index", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import usedPackage from "used-package"; console.log(usedPackage);`,
        "node_modules/used-package/package.json": JSON.stringify({
          name: "used-package",
          peerDependencies: { "peer-package": "*" },
        }),
        "node_modules/bin-package/package.json": JSON.stringify({
          name: "bin-package",
          bin: { "bin-command": "cli.js" },
        }),
      },
      {
        dependencies: {
          "used-package": "1.0.0",
          "peer-package": "1.0.0",
          "bin-package": "1.0.0",
          "unused-package": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("unused-package");
    expect(unusedPackageNames).toContain("bin-package");
    expect(unusedPackageNames).not.toContain("used-package");
    expect(unusedPackageNames).not.toContain("peer-package");
  });

  it("suppresses diagnostics for gitignored and generated files", async () => {
    const rootDirectory = createProject(
      {
        ".gitignore": "src/ignored.ts\n",
        "src/index.ts": "console.log('app');",
        "src/ignored.ts": "export const ignored = 1;",
        "dist/generated.ts": "export const generated = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );
    execFileSync("git", ["init", "--quiet"], { cwd: rootDirectory });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/ignored.ts", "dist/generated.ts"]),
    );
  });

  it("suppresses dynamic and function-only cycles", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import { loadDynamic } from "./dynamic-a";
          import { callFunctionCycle } from "./function-a";
          console.log(loadDynamic, callFunctionCycle);
        `,
        "src/dynamic-a.ts": `
          export const loadDynamic = () => import("./dynamic-b");
        `,
        "src/dynamic-b.ts": `
          import { loadDynamic } from "./dynamic-a";
          export const dynamicB = () => loadDynamic;
        `,
        "src/function-a.ts": `
          import { functionB } from "./function-b";
          export const callFunctionCycle = () => functionB();
        `,
        "src/function-b.ts": `
          import { callFunctionCycle } from "./function-a";
          export const functionB = () => callFunctionCycle();
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([]);
  });
});
