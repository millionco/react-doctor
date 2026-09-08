/**
 * Regression test for issue #1772: nested workspace project's config is
 * ignored when only the root project is selected.
 *
 * In a monorepo, nested workspace projects with their own configs (framework,
 * React Compiler, etc.) were only excluded from the root scan when they were
 * also selected for scanning. This caused files from non-selected nested
 * projects to be scanned with the parent's config, producing false positives
 * when configs differed.
 *
 * The fix discovers all supported subprojects and excludes them from the
 * parent scan, regardless of selection.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  discoverProject,
  runOxlint,
  discoverSupportedSubprojects,
  isPathInsideDirectory,
} from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-issue-1772-"));

const setupMonorepo = (): { root: string; web: string; native: string } => {
  const root = path.join(tempRoot, "monorepo");
  const web = path.join(root, "apps", "web");
  const native = path.join(root, "apps", "native");

  fs.mkdirSync(path.join(web, "src"), { recursive: true });
  fs.mkdirSync(path.join(native, "src"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "repro-root",
      private: true,
      version: "1.0.0",
      workspaces: ["apps/*"],
      dependencies: { react: "19.2.0", "react-dom": "19.2.0" },
      devDependencies: { vite: "7.1.0" },
    }),
  );

  fs.writeFileSync(
    path.join(web, "package.json"),
    JSON.stringify({
      name: "web",
      version: "1.0.0",
      dependencies: { react: "19.2.0", "react-dom": "19.2.0" },
      devDependencies: { vite: "7.1.0" },
    }),
  );

  fs.writeFileSync(
    path.join(native, "package.json"),
    JSON.stringify({
      name: "native",
      version: "1.0.0",
      main: "index.js",
      dependencies: { expo: "54.0.0", react: "19.2.0", "react-native": "0.81.0" },
      devDependencies: { "babel-plugin-react-compiler": "19.1.0" },
    }),
  );

  fs.writeFileSync(
    path.join(native, "app.config.ts"),
    `export default {
  expo: {
    name: 'native',
    slug: 'native',
    experiments: {
      reactCompiler: true,
    },
  },
};
`,
  );

  const panelSource = `import { FlatList } from 'react-native';

type Item = { id: string };

export const Panel = ({ items }: { items: Item[] }) => {
  const renderItem = ({ item }: { item: Item }) => <Row id={item.id} />;

  return <FlatList data={items} renderItem={renderItem} keyExtractor={(i) => i.id} />;
};

const Row = ({ id }: { id: string }) => <>{id}</>;
`;

  const thingSource = `export const Thing = ({ items }: { items: string[] }) => {
  const renderItem = (item: string) => <span key={item}>{item}</span>;

  return <div>{items.map(renderItem)}</div>;
};
`;

  fs.writeFileSync(path.join(native, "src", "panel.tsx"), panelSource);
  fs.writeFileSync(path.join(web, "src", "thing.tsx"), thingSource);

  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
      },
    }),
  );

  return { root, web, native };
};

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("Nested workspace config resolution (#1772)", () => {
  it("excludes nested workspace projects when scanning root only", async () => {
    const { root } = setupMonorepo();

    const project = discoverProject(root);

    const allSupportedSubprojects = discoverSupportedSubprojects(root);
    const resolvedRoot = path.resolve(root);
    const excludedDirectories = allSupportedSubprojects
      .filter((subproject) => {
        const subprojectDirectory = path.resolve(subproject.directory);
        return (
          isPathInsideDirectory(subprojectDirectory, root) && subprojectDirectory !== resolvedRoot
        );
      })
      .map((subproject) => subproject.directory);

    const diagnostics = await runOxlint({
      rootDirectory: root,
      project,
    });

    const panelDiagnosticsBeforeFilter = diagnostics.filter(
      (diagnostic) =>
        diagnostic.filePath.includes("panel.tsx") &&
        diagnostic.rule === "prefer-module-scope-pure-function",
    );

    expect(
      panelDiagnosticsBeforeFilter.length,
      "without exclusion, root scan incorrectly flags nested project files",
    ).toBeGreaterThan(0);

    const filteredDiagnostics = diagnostics.filter((diagnostic) => {
      const diagnosticPath = path.resolve(root, diagnostic.filePath);
      return !excludedDirectories.some((excludedDir) =>
        isPathInsideDirectory(diagnosticPath, excludedDir),
      );
    });

    const panelDiagnosticsAfterFilter = filteredDiagnostics.filter(
      (diagnostic) =>
        diagnostic.filePath.includes("panel.tsx") &&
        diagnostic.rule === "prefer-module-scope-pure-function",
    );

    expect(
      panelDiagnosticsAfterFilter,
      "after excluding nested projects, no false positive from panel.tsx",
    ).toHaveLength(0);

    expect(
      excludedDirectories.length,
      "should discover and exclude nested workspace projects",
    ).toBeGreaterThan(0);
  });

  it("suppresses React Compiler-gated rule when scanning the native project directly", async () => {
    const { native } = setupMonorepo();

    const project = discoverProject(native);
    expect(project.hasReactCompiler, "native project should have React Compiler enabled").toBe(
      true,
    );

    const diagnostics = await runOxlint({
      rootDirectory: native,
      project,
    });

    const panelDiagnostics = diagnostics.filter(
      (diagnostic) =>
        diagnostic.filePath.includes("panel.tsx") &&
        diagnostic.rule === "prefer-module-scope-pure-function",
    );

    expect(
      panelDiagnostics,
      "React Compiler-gated rule should be suppressed",
    ).toHaveLength(0);
  });
});
