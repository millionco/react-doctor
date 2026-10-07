import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";
import { resolveWorkspaces } from "../src/project-analysis/collect/workspaces.js";
import { collectPnpmWorkspaceOverrideMappings } from "../src/project-analysis/utils/parse-pnpm-workspace-overrides.js";

const temporaryDirectories: string[] = [];

const createDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-config-parsers-"));
  temporaryDirectories.push(directory);
  return fs.realpathSync(directory);
};

const writeFiles = (rootDirectory: string, files: Readonly<Record<string, string>>): void => {
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
};

const relativeUnusedPaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("project analysis config parsers", () => {
  it("discovers GitHub Actions scripts from folded and quoted YAML run scalars", async () => {
    const rootDirectory = createDirectory();
    writeFiles(rootDirectory, {
      "package.json": JSON.stringify({ name: "workflow-config" }),
      "src/index.ts": "console.log('entry');",
      "scripts/folded.ts": "console.log('folded');",
      "scripts/quoted.ts": "console.log('quoted');",
      "src/orphan.ts": "export const orphan = true;",
      ".github/workflows/check.yml": `jobs:
  check:
    steps:
      - run: >-
          node scripts/folded.ts
          --check
      - run: "node scripts/quoted.ts --check"
`,
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it.each([
    ["block", 'packages:\n  - "apps/*"\n'],
    ["flow", 'packages: ["apps/*"]\n'],
  ])("discovers declared pnpm workspaces from %s YAML sequences", (_, workspaceSource) => {
    const rootDirectory = createDirectory();
    writeFiles(rootDirectory, {
      "package.json": JSON.stringify({ name: "workspace-root", private: true }),
      "pnpm-workspace.yaml": workspaceSource,
      "apps/web/package.json": JSON.stringify({ name: "web" }),
    });

    const declaredWorkspaces = resolveWorkspaces(rootDirectory).packages.filter(
      (workspacePackage) => workspacePackage.isDeclaredWorkspace,
    );

    expect(declaredWorkspaces).toEqual([
      expect.objectContaining({
        name: "web",
        directory: path.join(rootDirectory, "apps/web").replaceAll("\\", "/"),
        depthFromRoot: 2,
      }),
    ]);
  });

  it("parses pnpm override flow mappings, anchors, and comments", () => {
    const rootDirectory = createDirectory();
    writeFiles(rootDirectory, {
      "pnpm-workspace.yaml": `shared: &shared
  source-package: npm:target-package@1.0.0
overrides: { <<: *shared, parent-package: { nested-source: "npm:nested-target@2.0.0" } } # merged
`,
    });

    expect(collectPnpmWorkspaceOverrideMappings(rootDirectory)).toEqual([
      { fromPackage: "source-package", toPackage: "target-package" },
      { fromPackage: "nested-source", toPackage: "nested-target" },
    ]);
  });

  it("uses the parsed Netlify functions table for quoted TOML keys", async () => {
    const rootDirectory = createDirectory();
    writeFiles(rootDirectory, {
      "package.json": JSON.stringify({ name: "netlify-config" }),
      "src/index.ts": "console.log('entry');",
      "netlify.toml": '[functions]\n"directory" = "server/functions"\n',
      "server/functions/notify.ts": "export default () => new Response();",
      "netlify/functions/dormant.ts": "export default () => new Response();",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "netlify/functions/dormant.ts",
    ]);
  });

  it("uses parsed JSONC worker fields without matching commented decoys", async () => {
    const rootDirectory = createDirectory();
    writeFiles(rootDirectory, {
      "package.json": JSON.stringify({ name: "worker-config" }),
      "wrangler.jsonc": `{
  // "main": "src/commented-decoy.ts",
  "main": "src/worker.ts",
  "services": [{ "entry_point": "src/service.ts" }],
}
`,
      "src/worker.ts": "export default { fetch: () => new Response() };",
      "src/service.ts": "export default { fetch: () => new Response() };",
      "src/commented-decoy.ts": "export default {};",
      "src/orphan.ts": "export const orphan = true;",
    });

    const result = await analyzeProject({ rootDirectory });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/commented-decoy.ts",
      "src/orphan.ts",
    ]);
  });
});
