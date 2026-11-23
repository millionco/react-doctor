import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

vi.mock("../../utils/read-verified-electron-renderer-compiler.js", () => ({
  readVerifiedElectronRendererCompiler: () => true,
}));

const fixtureDirectories: string[] = [];
const rendererFile = "src/renderer/src/Panel.jsx";
const configFile = "electron.vite.config.mjs";
const config = `
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
`;
const html = '<!doctype html><script type="module" src="/src/Panel.jsx"></script>';
const rendererSource = "export const Panel = () => <main />;";
const setup = (source = rendererSource, overrides: Readonly<Record<string, string>> = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electron-renderer-jsx-"));
  fixtureDirectories.push(directory);
  const files = {
    [configFile]: config,
    "src/main/index.js": 'import { app } from "electron"; void app;',
    "src/preload/index.js": "export {};",
    "src/renderer/index.html": html,
    [rendererFile]: source,
    ...overrides,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  return {
    source,
    filename: path.join(directory, rendererFile),
    settings: { "react-doctor": { rootDirectory: directory } },
  };
};

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("Electron renderer JSX runtime", () => {
  it.each(["curated", "upstream"])(
    "accepts implicit JSX factories when the selected renderer uses automatic JSX in %s mode",
    (portedRuleMode) => {
      const fixture = setup("export const Panel = () => <><main /></>;");
      const result = runRule(reactInJsxScope, fixture.source, {
        filename: fixture.filename,
        settings: { "react-doctor": { ...fixture.settings["react-doctor"], portedRuleMode } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    "export const Panel = () => <React.Fragment />;",
    "export const Panel = () => <React />;",
    'export const Panel = () => <main>{React.createElement("div")}</main>;',
    "/* @jsxRuntime classic */\nexport const Panel = () => <main />;",
  ])("retains a warning for %s", (source) => {
    const fixture = setup(source);
    const result = runRule(reactInJsxScope, fixture.source, fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each<Readonly<Record<string, string>>>([
    {
      [configFile]: config.replace(
        "renderer: { plugins: [react()] }",
        'renderer: { plugins: [react({ jsxRuntime: "classic" })] }',
      ),
    },
    {
      "src/renderer/index.html": html.replace('type="module"', 'type="text/javascript"'),
    },
    {
      "src/main/index.js": 'import "../renderer/src/Panel.jsx";',
    },
    {
      "src/preload/index.js": 'import "../renderer/src/Panel.jsx";',
    },
    {
      "src/main/index.js": 'import "../../shared/entry.js";',
      "shared/entry.js": 'import "../src/renderer/src/Panel.jsx";',
    },
    {
      "src/main/index.js": 'import "../renderer/src/shared.js";',
      "src/renderer/src/shared.js": 'import "/src/renderer/src/Panel.jsx";',
    },
  ])("retains warnings for a classic or shared compilation path", (overrides) => {
    const fixture = setup(rendererSource, overrides);
    const result = runRule(reactInJsxScope, fixture.source, fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
