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
