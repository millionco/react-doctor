import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  analyzeProject,
  analyzeProjectForWorker,
} from "../src/project-analysis/analyze-project.js";
import { toPosixPath } from "../src/project-analysis/utils/to-posix-path.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  dependencies: Readonly<Record<string, string>> = {},
  packageJsonFields: Readonly<Record<string, unknown>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-runtime-contracts-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify({ dependencies, ...packageJsonFields }),
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  fs.writeFileSync(
    path.join(rootDirectory, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies },
        ...Object.fromEntries(
          Object.entries(dependencies).map(([dependencyName, version]) => [
            `node_modules/${dependencyName}`,
            { version },
          ]),
        ),
      },
    }),
  );
  return fs.realpathSync(rootDirectory);
};

const getUnusedExportNames = async (rootDirectory: string): Promise<string[]> => {
  const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
  return result.unusedExports.map((finding) => finding.name);
};

describe("runtime-owned project analysis contracts", () => {
  const createVersionedTypesProject = (
    fields: Readonly<Record<string, unknown>>,
    declaration = 'export type { PublicMedia as Media } from "../src/media.js";',
  ): string =>
    createProject(
      {
        "src/index.ts": 'import { pickedRuntime } from "./media.js"; console.log(pickedRuntime);',
        "src/media.ts": `export const pickedRuntime = 1;
        export const UnusedRuntime = 2;
        export type PublicMedia = { id: string };
        export type PrivateMedia = { stale: true };`,
        "src/orphan.ts": "export const orphan = 3;",
        "types/media.d.ts": declaration,
        "types/shadow.d.ts": "export type Shadow = number;",
      },
      {},
      { name: "example-media", version: "1.0.0", files: ["src", "types"], ...fields },
    );

  const versionedMedia = { "*": { media: ["types/media.d.ts"] } };

  it("recognizes only the named type re-exported by an exact typesVersions declaration", async () => {
    const rootDirectory = createVersionedTypesProject({
      typesVersions: versionedMedia,
      publishConfig: { access: "public" },
    });
    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.analysisErrors).toEqual([]);
    expect(result.unusedExports.map((finding) => finding.name).sort()).toEqual([
      "PrivateMedia",
      "UnusedRuntime",
    ]);
    expect(
      result.unusedFiles.map((finding) => toPosixPath(path.relative(rootDirectory, finding.path))),
    ).toEqual(["src/orphan.ts"]);
  });

  it.each([
    [
      "declaration excluded from packed files",
      { files: ["src"], typesVersions: versionedMedia },
      undefined,
    ],
    [
      "implementation excluded from packed files",
      { files: ["src/index.ts", "types"], typesVersions: versionedMedia },
      undefined,
    ],
    ["private package", { private: true, typesVersions: versionedMedia }, undefined],
    [
      "nonliteral packed list",
      { files: ["src", "types", "!types/media.d.ts"], typesVersions: versionedMedia },
      undefined,
    ],
    [
      "duplicate public name",
      { typesVersions: versionedMedia },
      'export type { PublicMedia as Media, PrivateMedia as Media } from "../src/media.js";',
    ],
    [
      "published exports override",
      { typesVersions: versionedMedia, publishConfig: { exports: { ".": "./src/index.ts" } } },
      undefined,
    ],
    [
      "published versions override",
      { typesVersions: versionedMedia, publishConfig: { typesVersions: { "*": {} } } },
      undefined,
    ],
    [
      "published subdirectory",
      { typesVersions: versionedMedia, publishConfig: { directory: "dist" } },
      undefined,
    ],
    ["missing mapping", {}, undefined],
    [
      "encapsulated subpath",
      { exports: { ".": "./src/index.ts" }, typesVersions: versionedMedia },
      undefined,
    ],
    [
      "earlier compiler range",
      { typesVersions: { ">=5": { media: ["types/shadow.d.ts"] }, ...versionedMedia } },
      undefined,
    ],
    ["wildcard mapping", { typesVersions: { "*": { "*": ["types/*.d.ts"] } } }, undefined],
    [
      "missing declaration",
      { typesVersions: { "*": { media: ["types/absent.d.ts"] } } },
      undefined,
    ],
    [
      "fallback targets",
      { typesVersions: { "*": { media: ["types/absent.d.ts", "types/media.d.ts"] } } },
      undefined,
    ],
    [
      "value re-export",
      { typesVersions: versionedMedia },
      'export { PublicMedia } from "../src/media.js";',
    ],
    [
      "wildcard re-export",
      { typesVersions: versionedMedia },
      'export type * from "../src/media.js";',
    ],
  ] as const)("keeps candidate warnings with %s", async (_name, fields, declaration) => {
    const rootDirectory = createVersionedTypesProject(fields, declaration);
    expect((await getUnusedExportNames(rootDirectory)).sort()).toEqual([
      "PrivateMedia",
      "PublicMedia",
      "UnusedRuntime",
    ]);
  });

  it("retains a declaration that depends on the producer's local TypeScript paths", async () => {
    const rootDirectory = createVersionedTypesProject(
      { typesVersions: versionedMedia },
      'export type { PublicMedia } from "@internal/media";',
    );
    fs.writeFileSync(
      path.join(rootDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@internal/media": ["./src/media.ts"] } },
      }),
    );
    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/index.ts"],
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });
    expect(result.unusedExports.map((finding) => finding.name).sort()).toEqual([
      "PrivateMedia",
      "PublicMedia",
      "UnusedRuntime",
    ]);
  });

  it("retains a type if a nested npm ignore can exclude its declaration", async () => {
    const rootDirectory = createVersionedTypesProject({ typesVersions: versionedMedia });
    fs.writeFileSync(path.join(rootDirectory, "types", ".npmignore"), "media.d.ts\n");
    expect((await getUnusedExportNames(rootDirectory)).sort()).toEqual([
      "PrivateMedia",
      "PublicMedia",
      "UnusedRuntime",
    ]);
  });

  it("keeps skipped dependency metadata on the worker wire only", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": `import "used-package";` },
      { "used-package": "1.0.0", "unused-package": "1.0.0" },
    );
    const input = { rootDirectory, entryPatterns: ["src/index.ts"] };

    const publicResult = await analyzeProject(input);
    const workerResult = await analyzeProjectForWorker(input);

    expect("skippedDependencies" in publicResult).toBe(false);
    expect(workerResult.skippedDependencies).toEqual([]);
  });

  it("discovers Supabase Edge Function entry modules", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `console.log("application");`,
      "supabase/functions/scout-cron/index.ts": `import "./agent";`,
      "supabase/functions/scout-cron/agent.ts": `export const runAgent = true;`,
      "supabase/functions/shared/helper.ts": `export const helper = true;`,
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedFiles.map((finding) => finding.path)).toEqual([
      toPosixPath(path.join(rootDirectory, "supabase/functions/shared/helper.ts")),
    ]);
  });

  it("discovers source files selected by package import conditions", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `console.log("application");`,
        "src/browser.ts": `export const browser = true;`,
        "src/server.ts": `export const server = true;`,
        "src/orphan.ts": `export const orphan = true;`,
      },
      {},
      {
        imports: {
          "#runtime": {
            browser: "./src/browser.ts",
            default: "./src/server.ts",
          },
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedFiles.map((finding) => finding.path)).toEqual([
      toPosixPath(path.join(rootDirectory, "src/orphan.ts")),
    ]);
  });

  it("discovers style-expanded registry files consumed by build scripts", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `console.log("application");`,
        "src/scripts/build-registry.mts": `
          import { blocks } from "../registry/registry-blocks";
          import { styles } from "../registry/registry-styles";
          import { unrelatedMetadata } from "../registry/unrelated-metadata";
          for (const style of styles) {
            for (const item of blocks) {
              item.files.map((file) => \`src/registry/\${style.name}/\${file.path}\`);
            }
          }
          console.log(unrelatedMetadata);
        `,
        "src/registry/registry-blocks.ts": `
          export const blocks = [{ files: [{ path: "block/sidebar/hooks/use-sidebar.tsx" }] }];
        `,
        "src/registry/registry-styles.ts": `
          export const styles = [{ name: "default" }, { name: "new-york" }];
        `,
        "src/registry/unrelated-metadata.ts": `
          export const unrelatedMetadata = {
            name: "default",
            path: "block/sidebar/hooks/orphan.tsx",
          };
        `,
        "src/registry/default/block/sidebar/hooks/use-sidebar.tsx": `export const useSidebar = () => true;`,
        "src/registry/new-york/block/sidebar/hooks/use-sidebar.tsx": `export const useSidebar = () => true;`,
        "src/registry/default/block/sidebar/hooks/orphan.tsx": `export const orphan = true;`,
      },
      {},
      { scripts: { build: "tsx src/scripts/build-registry.mts" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedFiles.map((finding) => finding.path)).toEqual([
      toPosixPath(path.join(rootDirectory, "src/registry/default/block/sidebar/hooks/orphan.tsx")),
    ]);
  });

  it("does not infer registry fanout from unrelated path and name fields", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `console.log("application");`,
        "src/scripts/build.mts": `
          import { metadata } from "../registry/metadata";
          console.log(metadata);
        `,
        "src/registry/metadata.ts": `
          export const metadata = {
            name: "default",
            path: "block/sidebar/hooks/use-sidebar.tsx",
          };
        `,
        "src/registry/default/block/sidebar/hooks/use-sidebar.tsx": `export const useSidebar = () => true;`,
      },
      {},
      { scripts: { build: "tsx src/scripts/build.mts" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedFiles.map((finding) => finding.path)).toEqual([
      toPosixPath(
        path.join(rootDirectory, "src/registry/default/block/sidebar/hooks/use-sidebar.tsx"),
      ),
    ]);
  });

  it("credits only the statically selected CommonJS export", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `console.log(require("./NativeFeature").default);`,
      "src/NativeFeature.ts": `
        export default "native";
        export const unusedNativeHelper = "unused";
      `,
    });

    expect(await getUnusedExportNames(rootDirectory)).toEqual(["unusedNativeHelper"]);
  });

  it("supports string-literal CommonJS member selection without crediting siblings", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `console.log(require("./feature")["selected"]);`,
      "src/feature.ts": `
        export const selected = "selected";
        export const unselected = "unselected";
      `,
    });

    expect(await getUnusedExportNames(rootDirectory)).toEqual(["unselected"]);
  });

  it("keeps dynamic CommonJS member access conservative", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `
        const selectedName = Math.random() > 0.5 ? "first" : "second";
        console.log(require("./feature")[selectedName]);
      `,
      "src/feature.ts": `
        export const first = "first";
        export const second = "second";
      `,
    });

    expect(await getUnusedExportNames(rootDirectory)).toEqual([]);
  });

  it("does not treat CommonJS syntax inside strings as an export reference", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `
        import "./feature";
        console.log('require("./feature").default');
      `,
      "src/feature.ts": `
        export default "default";
        export const named = "named";
      `,
    });

    expect(await getUnusedExportNames(rootDirectory)).toEqual(["default", "named"]);
  });

  it("retains React Native Codegen Spec references below TypeScript value wrappers", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `import NativeFeature from "./NativeFeature"; console.log(NativeFeature);`,
      "src/NativeFeature.ts": `
        interface TurboModule {}
        declare const TurboModuleRegistry: {
          get<Module>(name: string): Module | null;
        };
        export interface Spec extends TurboModule {
          read(): string;
        }
        export interface UnusedSpec extends TurboModule {
          write(): void;
        }
        export default TurboModuleRegistry.get<Spec>("NativeFeature") as Spec | null;
      `,
    });

    expect(await getUnusedExportNames(rootDirectory)).toEqual(["UnusedSpec"]);
  });

  it("does not infer Codegen usage from a Native filename alone", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `import NativeFeature from "./NativeFeature"; console.log(NativeFeature);`,
      "src/NativeFeature.ts": `
        export interface UnusedSpec {
          read(): string;
        }
        export default "native";
      `,
    });

    expect(await getUnusedExportNames(rootDirectory)).toEqual(["UnusedSpec"]);
  });

  it("credits Expo Router's RSC dependency only when React Server Functions are enabled", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import "expo-router";`,
        "app.json": JSON.stringify({
          expo: { experiments: { reactServerFunctions: true } },
        }),
      },
      {
        "expo-router": "1.0.0",
        "react-server-dom-webpack": "1.0.0",
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    expect(result.unusedDependencies.map((finding) => finding.name)).not.toContain(
      "react-server-dom-webpack",
    );
  });

  it("reports the RSC dependency when the Expo experiment is disabled", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import "expo-router";`,
        "app.json": JSON.stringify({
          expo: { experiments: { reactServerFunctions: false } },
        }),
      },
      {
        "expo-router": "1.0.0",
        "react-server-dom-webpack": "1.0.0",
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    expect(result.unusedDependencies.map((finding) => finding.name)).toContain(
      "react-server-dom-webpack",
    );
  });

  it("does not credit the RSC dependency without an observed Expo Router runtime", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `console.log("standalone");`,
        "app.json": JSON.stringify({
          expo: { experiments: { reactServerFunctions: true } },
        }),
      },
      {
        "react-server-dom-webpack": "1.0.0",
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    expect(result.unusedDependencies.map((finding) => finding.name)).toContain(
      "react-server-dom-webpack",
    );
  });
});
