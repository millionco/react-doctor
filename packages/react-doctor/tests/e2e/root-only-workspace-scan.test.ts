import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { writeFile, writeJson } from "../regressions/_helpers.js";

interface CliProjectReport {
  readonly directory: string;
  readonly diagnostics: ReadonlyArray<{ readonly filePath: string; readonly rule: string }>;
}

interface CliWorkspaceReport {
  readonly projects: ReadonlyArray<CliProjectReport>;
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);
const temporaryRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "rd-root-only-workspace-scan-")),
);

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const RULE_UNDER_TEST = "prefer-module-scope-pure-function";

const NATIVE_PANEL = `import { FlatList } from "react-native";

interface Item {
  id: string;
}

const Row = ({ id }: { id: string }) => <>{id}</>;

export const Panel = ({ items }: { items: Item[] }) => {
  const renderItem = ({ item }: { item: Item }) => <Row id={item.id} />;
  return <FlatList data={items} renderItem={renderItem} keyExtractor={(entry) => entry.id} />;
};
`;

const WEB_LIST = `export const List = ({ items }: { items: string[] }) => {
  const renderItem = (item: string) => <span key={item}>{item}</span>;
  return <div>{items.map(renderItem)}</div>;
};
`;

const TSCONFIG = {
  compilerOptions: { jsx: "react-jsx", strict: true, target: "es2022", module: "esnext" },
};

const setupWorkspace = (): string => {
  const rootDirectory = path.join(temporaryRoot, "issue-1772");
  writeJson(path.join(rootDirectory, "package.json"), {
    name: "workspace-root",
    private: true,
    workspaces: ["apps/*"],
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
    devDependencies: { vite: "^7.0.0" },
  });
  writeJson(path.join(rootDirectory, "tsconfig.json"), TSCONFIG);
  writeFile(path.join(rootDirectory, "src/list.tsx"), WEB_LIST);
  writeJson(path.join(rootDirectory, "apps/native/package.json"), {
    name: "native",
    main: "index.js",
    dependencies: { expo: "^54.0.0", react: "^19.0.0", "react-native": "^0.81.0" },
    devDependencies: { "babel-plugin-react-compiler": "^19.0.0" },
  });
  writeJson(path.join(rootDirectory, "apps/native/tsconfig.json"), TSCONFIG);
  writeFile(
    path.join(rootDirectory, "apps/native/app.config.ts"),
    'export default { expo: { name: "native", slug: "native", experiments: { reactCompiler: true } } };\n',
  );
  writeFile(path.join(rootDirectory, "apps/native/src/panel.tsx"), NATIVE_PANEL);
  return rootDirectory;
};

const runScan = (directory: string, projects: string): CliWorkspaceReport => {
  const result = spawnSync(
    process.execPath,
    [
      builtCliPath,
      ".",
      "--project",
      projects,
      "--json",
      "--no-score",
      "--no-supply-chain",
      "--no-telemetry",
      "--no-cache",
    ],
    { cwd: directory, encoding: "utf8", env: { ...process.env, CI: "1", FORCE_COLOR: "0" } },
  );
  return JSON.parse(result.stdout);
};

const collectRuleHitPaths = (report: CliWorkspaceReport): string[] =>
  report.projects.flatMap((projectReport) =>
    projectReport.diagnostics
      .filter((diagnostic) => diagnostic.rule === RULE_UNDER_TEST)
      .map((diagnostic) => path.resolve(projectReport.directory, diagnostic.filePath)),
  );

describe.skipIf(!hasBuiltCli)("root-only scan of a workspace with a nested project", () => {
  it("leaves nested project files to that project's own config", () => {
    const rootDirectory = setupWorkspace();
    const rootListPath = path.join(rootDirectory, "src/list.tsx");
    const nativePanelPath = path.join(rootDirectory, "apps/native/src/panel.tsx");

    const bothReport = runScan(rootDirectory, "workspace-root,native");
    expect(bothReport.projects.map((projectReport) => projectReport.directory)).toEqual([
      rootDirectory,
      path.join(rootDirectory, "apps/native"),
    ]);
    expect(collectRuleHitPaths(bothReport)).toEqual([rootListPath]);

    const rootOnlyReport = runScan(rootDirectory, "workspace-root");
    expect(rootOnlyReport.projects.map((projectReport) => projectReport.directory)).toEqual([
      rootDirectory,
    ]);
    expect(collectRuleHitPaths(rootOnlyReport)).toEqual([rootListPath]);
    expect(collectRuleHitPaths(rootOnlyReport)).not.toContain(nativePanelPath);
  }, 120_000);
});
