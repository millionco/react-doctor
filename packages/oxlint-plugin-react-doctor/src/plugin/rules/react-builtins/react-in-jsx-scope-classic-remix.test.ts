import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

vi.mock("../../utils/read-verified-classic-remix-compiler.js", () => ({
  hasVerifiedClassicRemixCompiler: () => true,
}));

const routeFile = "app/routes/profile-settings.tsx";
const remixConfig = 'module.exports = { serverModuleFormat: "cjs" };';
const tsconfig = JSON.stringify({ compilerOptions: { noEmit: true, jsx: "react-jsx" } });
const implicitSource = "export default function Settings() { return <main />; }";
const projectDirectories: string[] = [];

const fixture = (source = implicitSource, overrides: Readonly<Record<string, string>> = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classic-remix-jsx-"));
  projectDirectories.push(directory);
  const files = {
    "package.json": JSON.stringify({
      scripts: { build: "run-s build:*", "build:remix": "remix build" },
    }),
    "remix.config.js": remixConfig,
    "tsconfig.json": tsconfig,
    "app/root.tsx": "export default function Root() {}",
    [routeFile]: source,
    ...overrides,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const filename = path.join(directory, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  }
  return {
    filename: path.join(directory, routeFile),
    settings: { "react-doctor": { rootDirectory: directory } },
  };
};

afterEach(() => {
  for (const directory of projectDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("classic Remix JSX runtime", () => {
  it("recognizes implicit JSX factories in a verified default classic route", () => {
    const result = runRule(reactInJsxScope, implicitSource, fixture());
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "/* @jsxRuntime classic */\nexport default function Settings() { return <main />; }",
    "export default function Settings() { return <React.Fragment />; }",
    "export default function Settings() { return <main>{React.version}</main>; }",
  ])("retains warnings for explicit factory or React references", (source) => {
    const result = runRule(reactInJsxScope, source, fixture(source));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each<Readonly<Record<string, string>>>([
    { "remix.config.js": 'module.exports = { serverModuleFormat: "cjs", postcss: true };' },
    { "app/routes/profile-settings.jsx": implicitSource },
    { "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: false, jsx: "react-jsx" } }) },
    { "package.json": JSON.stringify({ scripts: { build: "remix vite:build" } }) },
  ])("retains warnings for an unproved compiler route", (overrides) => {
    const result = runRule(reactInJsxScope, implicitSource, fixture(implicitSource, overrides));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
