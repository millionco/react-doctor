import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  analyzeSourceArchitecture,
  formatSourceArchitectureFailures,
} from "./check-source-architecture.js";

const withSourceFixture = (
  files: Readonly<Record<string, string>>,
  runTest: (rootDirectory: string) => void,
): void => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-architecture-"));
  try {
    for (const [relativePath, sourceText] of Object.entries(files)) {
      const filePath = path.join(rootDirectory, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, sourceText);
    }
    runTest(rootDirectory);
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
};

describe("source architecture", () => {
  it("reports deterministic runtime import components and leaves acyclic files out", () => {
    withSourceFixture(
      {
        "src/a.ts": 'import { valueB } from "./b";\nexport const valueA = valueB;\n',
        "src/b.ts": 'export { valueA } from "./a";\nexport const valueB = 1;\n',
        "src/leaf.ts": "export const leaf = true;\n",
      },
      (rootDirectory) => {
        const result = analyzeSourceArchitecture({
          rootDirectory,
          sourceDirectories: ["src"],
          forbiddenDependencyRules: [],
        });
        assert.deepEqual(
          result.runtimeImportComponents.map((component) =>
            component.map((filePath) => path.relative(rootDirectory, filePath)),
          ),
          [[path.join("src", "a.ts"), path.join("src", "b.ts")]],
        );
      },
    );
  });

  it("excludes type-only and dynamic imports from runtime components", () => {
    withSourceFixture(
      {
        "src/type-a.ts":
          'import type { TypeB } from "./type-b";\nexport interface TypeA extends TypeB {}\n',
        "src/type-b.ts":
          'import { typeValue } from "./type-a";\nexport interface TypeB {}\nexport const value = typeValue;\n',
        "src/lazy-a.ts": 'export const load = () => import("./lazy-b");\n',
        "src/lazy-b.ts": 'import { load } from "./lazy-a";\nexport const loaded = load;\n',
      },
      (rootDirectory) => {
        const result = analyzeSourceArchitecture({
          rootDirectory,
          sourceDirectories: ["src"],
          forbiddenDependencyRules: [],
        });
        assert.deepEqual(result.runtimeImportComponents, []);
        assert.equal(
          result.dependencies.some((dependency) => dependency.isTypeOnly),
          true,
        );
        assert.equal(
          result.dependencies.some((dependency) => dependency.isDynamic),
          true,
        );
      },
    );
  });

  it("resolves extensionless indexes and JavaScript specifiers to TypeScript sources", () => {
    withSourceFixture(
      {
        "src/a.ts": 'import { feature } from "./feature?raw";\nexport const value = feature;\n',
        "src/feature/index.ts": 'import { value } from "../a.js";\nexport const feature = value;\n',
      },
      (rootDirectory) => {
        const result = analyzeSourceArchitecture({
          rootDirectory,
          sourceDirectories: ["src"],
          forbiddenDependencyRules: [],
        });
        assert.deepEqual(
          result.runtimeImportComponents.map((component) =>
            component.map((filePath) => path.relative(rootDirectory, filePath)),
          ),
          [[path.join("src", "a.ts"), path.join("src", "feature", "index.ts")]],
        );
      },
    );
  });

  it("includes workspace package imports in runtime components", () => {
    withSourceFixture(
      {
        "packages/a/package.json":
          '{"name":"@fixture/a","exports":{".":{"default":"./dist/public.js"}}}',
        "packages/a/src/public.ts":
          'import { valueB } from "@fixture/b";\nexport const valueA = valueB;\n',
        "packages/b/package.json": '{"name":"@fixture/b"}',
        "packages/b/src/index.ts":
          'import { valueA } from "@fixture/a";\nexport const valueB = valueA;\n',
      },
      (rootDirectory) => {
        const result = analyzeSourceArchitecture({ rootDirectory });
        assert.deepEqual(
          result.runtimeImportComponents.map((component) =>
            component.map((filePath) => path.relative(rootDirectory, filePath)),
          ),
          [
            [
              path.join("packages", "a", "src", "public.ts"),
              path.join("packages", "b", "src", "index.ts"),
            ],
          ],
        );
        assert.deepEqual(
          result.dependencies.map((dependency) => dependency.specifier),
          ["@fixture/b", "@fixture/a"],
        );
        assert.match(
          formatSourceArchitectureFailures(rootDirectory, result),
          /Runtime import SCC \(2 files\)/,
        );
      },
    );
  });

  it("applies layer rules across workspace package subpaths", () => {
    withSourceFixture(
      {
        "packages/contracts/package.json": '{"name":"@fixture/contracts"}',
        "packages/contracts/src/contracts.ts":
          'import type { CliState } from "@fixture/runtime/cli/state";\nexport const loadCli = () => import("@fixture/runtime/cli");\nexport interface Contract extends CliState {}\n',
        "packages/runtime/package.json":
          '{"name":"@fixture/runtime","exports":{"./cli":{"default":"./dist/cli/index.js"},"./cli/state":{"types":"./dist/cli/state.d.ts"}}}',
        "packages/runtime/src/cli/index.ts": "export const cli = true;\n",
        "packages/runtime/src/cli/state.ts": "export interface CliState {}\n",
      },
      (rootDirectory) => {
        const result = analyzeSourceArchitecture({ rootDirectory });
        assert.deepEqual(
          result.forbiddenDependencies.map((dependency) => ({
            specifier: dependency.specifier,
            line: dependency.line,
            typeOnly: dependency.isTypeOnly,
            dynamic: dependency.isDynamic,
          })),
          [
            {
              specifier: "@fixture/runtime/cli",
              line: 2,
              typeOnly: false,
              dynamic: true,
            },
            {
              specifier: "@fixture/runtime/cli/state",
              line: 1,
              typeOnly: true,
              dynamic: false,
            },
          ],
        );
      },
    );
  });

  it("rejects type-only and dynamic backward edges with actionable locations", () => {
    withSourceFixture(
      {
        "packages/example/src/contracts.ts":
          'import type { CliState } from "./cli/state";\nexport const loadCli = () => import("./cli/index");\nexport interface Contract extends CliState {}\n',
        "packages/example/src/cli/index.ts": "export const cli = true;\n",
        "packages/example/src/cli/state.ts": "export interface CliState {}\n",
      },
      (rootDirectory) => {
        const result = analyzeSourceArchitecture({ rootDirectory });
        assert.equal(result.forbiddenDependencies.length, 2);
        assert.deepEqual(
          result.forbiddenDependencies.map((dependency) => ({
            line: dependency.line,
            typeOnly: dependency.isTypeOnly,
            dynamic: dependency.isDynamic,
            rule: dependency.ruleName,
          })),
          [
            { line: 2, typeOnly: false, dynamic: true, rule: "neutral-foundations" },
            { line: 1, typeOnly: true, dynamic: false, rule: "neutral-foundations" },
          ],
        );

        const output = formatSourceArchitectureFailures(rootDirectory, result);
        assert.match(output, /packages\/example\/src\/contracts\.ts:1/);
        assert.match(output, /packages\/example\/src\/cli\/state\.ts/);
        assert.match(output, /Foundation types, schemas, and errors must remain independent/);
      },
    );
  });
});
