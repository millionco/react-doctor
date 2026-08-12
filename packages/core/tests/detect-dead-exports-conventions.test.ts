import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseSourceFile } from "../src/project-analysis/collect/parse.js";
import { defineProjectAnalysisConfig } from "../src/project-analysis/config.js";
import { buildDependencyGraph } from "../src/project-analysis/linker/build.js";
import { detectDeadExports } from "../src/project-analysis/report/exports.js";
import type { DependencyGraph } from "../src/project-analysis/types.js";

interface TestProjectOptions {
  files: Readonly<Record<string, string>>;
  modulePaths: ReadonlyArray<string>;
  packageJson: Readonly<Record<string, unknown>>;
}

interface TestProject {
  graph: DependencyGraph;
  rootDirectory: string;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (options: TestProjectOptions): TestProject => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-export-conventions-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(options.packageJson));

  for (const [relativePath, source] of Object.entries(options.files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }

  const graph = buildDependencyGraph(
    options.modulePaths.map((relativePath, moduleIndex) => {
      const filePath = path.join(rootDirectory, relativePath);
      return {
        fileId: { index: moduleIndex, path: filePath },
        parsed: parseSourceFile(filePath),
        resolvedImports: new Map(),
        isEntryPoint: false,
        isExternallyConsumed: false,
        isTestEntry: false,
        isGitIgnored: false,
        isAnalysisExcluded: false,
      };
    }),
  );
  for (const module of graph.modules) module.isReachable = true;

  return { graph, rootDirectory: fs.realpathSync(rootDirectory) };
};

const collectUnusedExports = (project: TestProject): string[] =>
  detectDeadExports(project.graph, defineProjectAnalysisConfig({ rootDir: project.rootDirectory }))
    .map(
      (finding) =>
        `${path.relative(project.rootDirectory, finding.path).replaceAll("\\", "/")}::${finding.name}`,
    )
    .sort();

describe("convention-consumed exports", () => {
  it("credits runtime only in Next App Router route-segment modules", () => {
    const project = createProject({
      files: {
        "app/page.tsx": `
          export const runtime = "edge";
          export const pageOnly = true;
        `,
        "src/app/api/route.ts": `
          export const runtime = "nodejs";
          export const routeOnly = true;
        `,
        "app/posts/opengraph-image.tsx": `
          export const runtime = "edge";
          export const imageOnly = true;
        `,
        "app/helpers.ts": `
          export const runtime = "edge";
        `,
        "src/runtime.ts": `
          export const runtime = "edge";
          export const runtimeVersion = "1";
        `,
      },
      modulePaths: [
        "app/page.tsx",
        "src/app/api/route.ts",
        "app/posts/opengraph-image.tsx",
        "app/helpers.ts",
        "src/runtime.ts",
      ],
      packageJson: { dependencies: { next: "1.0.0" } },
    });

    expect(collectUnusedExports(project)).toEqual([
      "app/helpers.ts::runtime",
      "app/page.tsx::pageOnly",
      "app/posts/opengraph-image.tsx::imageOnly",
      "src/app/api/route.ts::routeOnly",
      "src/runtime.ts::runtime",
      "src/runtime.ts::runtimeVersion",
    ]);
  });

  it("credits only a package-root Content Collections default export", () => {
    const project = createProject({
      files: {
        "content-collections.ts": `
          export const unusedCollection = true;
          export default {};
        `,
        "src/content-collections.ts": "export default {};",
      },
      modulePaths: ["content-collections.ts", "src/content-collections.ts"],
      packageJson: {
        devDependencies: { "@content-collections/core": "1.0.0" },
      },
    });

    expect(collectUnusedExports(project)).toEqual([
      "content-collections.ts::unusedCollection",
      "src/content-collections.ts::default",
    ]);
  });

  it("credits only the Nextra theme default explicitly referenced by next.config", () => {
    const project = createProject({
      files: {
        "next.config.ts": `
          import nextra from "nextra";
          const withNextra = nextra({
            themeConfig: "./theme.config.tsx",
            other: "./other/theme.config.tsx",
          });
          // themeConfig: "./ignored/theme.config.tsx"
          export default withNextra({});
        `,
        "theme.config.tsx": `
          export const unusedThemeValue = true;
          export default {};
        `,
        "other/theme.config.tsx": "export default {};",
        "ignored/theme.config.tsx": "export default {};",
      },
      modulePaths: ["theme.config.tsx", "other/theme.config.tsx", "ignored/theme.config.tsx"],
      packageJson: { dependencies: { next: "1.0.0", nextra: "1.0.0" } },
    });

    expect(collectUnusedExports(project)).toEqual([
      "ignored/theme.config.tsx::default",
      "other/theme.config.tsx::default",
      "theme.config.tsx::unusedThemeValue",
    ]);
  });

  it("credits React Email dev template defaults without hiding adjacent modules", () => {
    const project = createProject({
      files: {
        "emails/templates/welcome.tsx": `
          export const welcomeData = {};
          export default () => null;
        `,
        "emails/templates/nested/invite.jsx": "export default () => null;",
        "emails/templates/_components/layout.tsx": "export default () => null;",
        "emails/template/misspelled.tsx": "export default () => null;",
        "src/emails/templates/source.tsx": "export default () => null;",
      },
      modulePaths: [
        "emails/templates/welcome.tsx",
        "emails/templates/nested/invite.jsx",
        "emails/templates/_components/layout.tsx",
        "emails/template/misspelled.tsx",
        "src/emails/templates/source.tsx",
      ],
      packageJson: {
        devDependencies: { "react-email": "1.0.0" },
        scripts: { email: "email dev" },
      },
    });

    expect(collectUnusedExports(project)).toEqual([
      "emails/template/misspelled.tsx::default",
      "emails/templates/_components/layout.tsx::default",
      "emails/templates/welcome.tsx::welcomeData",
      "src/emails/templates/source.tsx::default",
    ]);
  });

  it("keeps convention-shaped defaults reportable without their consuming tools", () => {
    const project = createProject({
      files: {
        "app/page.tsx": "export const runtime = 'edge';",
        "content-collections.ts": "export default {};",
        "emails/templates/welcome.tsx": "export default () => null;",
        "theme.config.tsx": "export default {};",
      },
      modulePaths: [
        "app/page.tsx",
        "content-collections.ts",
        "emails/templates/welcome.tsx",
        "theme.config.tsx",
      ],
      packageJson: {},
    });

    expect(collectUnusedExports(project)).toEqual([
      "app/page.tsx::runtime",
      "content-collections.ts::default",
      "emails/templates/welcome.tsx::default",
      "theme.config.tsx::default",
    ]);
  });

  it("credits conventions when graph paths use a symlinked project alias", () => {
    const project = createProject({
      files: {
        "app/page.tsx": `
          export const runtime = "edge";
          export const pageOnly = true;
        `,
      },
      modulePaths: ["app/page.tsx"],
      packageJson: { dependencies: { next: "1.0.0" } },
    });
    const aliasParentDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-export-conventions-alias-"),
    );
    temporaryDirectories.push(aliasParentDirectory);
    const aliasRootDirectory = path.join(aliasParentDirectory, "project");
    fs.symlinkSync(project.rootDirectory, aliasRootDirectory, "junction");
    project.graph.modules[0].fileId.path = path.join(aliasRootDirectory, "app/page.tsx");

    const unusedExportNames = detectDeadExports(
      project.graph,
      defineProjectAnalysisConfig({ rootDir: project.rootDirectory }),
    ).map((finding) => finding.name);

    expect(unusedExportNames).toEqual(["pageOnly"]);
  });
});
