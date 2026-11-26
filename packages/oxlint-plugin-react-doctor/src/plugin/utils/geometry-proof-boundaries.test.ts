import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasReadonlyRendererImportBindings } from "./has-readonly-renderer-import-bindings.js";
import { isInferredTypeOnlyAssertionImport } from "./is-inferred-type-only-assertion-import.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStandaloneVitePlainCss } from "./read-standalone-vite-plain-css.js";

const parseProgram = (source: string) => {
  const parsed = parseFixture(source, { filename: "fixture.tsx" });
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  return parsed.program;
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("geometry renderer binding boundaries", () => {
  it("accepts direct named component use without granting provider identity", () => {
    const program = parseProgram(`
      import { Instances, Instance } from "@react-three/drei";
      export const Field = () => <Instances><Instance position={[0, 0, 0]} /></Instances>;
    `);
    expect(hasReadonlyRendererImportBindings(program, analyzeScopes(program))).toBe(true);
  });

  it.each([
    `import React from "react"; React.useMemo = calculateFromInputs;`,
    `import { Instance } from "@react-three/drei"; Instance.render = renderMarker;`,
    `import { Instances } from "@react-three/drei"; const carrier = Instances;`,
    `import { Instances } from "@react-three/drei"; Object.assign(Instances, { render() {} });`,
    `import * as Scene from "@react-three/drei"; Object.defineProperty(Scene, "Instances", { value() {} });`,
    `import * as Scene from "@react-three/drei"; const { Instances } = Scene;`,
    `import { Instance } from "@react-three/drei"; const carrier = { Instance };`,
    `export { Instances } from "@react-three/drei";`,
  ])("rejects an imported renderer mutation or escape: %s", (source) => {
    const program = parseProgram(source);
    expect(hasReadonlyRendererImportBindings(program, analyzeScopes(program))).toBe(false);
  });
});

describe("selected emitter type import boundary", () => {
  it("allows an intersection reference only with the selected named-type mode", () => {
    const program = parseProgram(`
      import { Shape } from "./shape";
      type Local = { label: string } & Shape;
    `);
    if (!isNodeOfType(program, "Program")) throw new Error("Expected Program");
    const declaration = program.body[0];
    if (!isNodeOfType(declaration, "ImportDeclaration")) throw new Error("Expected import");
    const scopes = analyzeScopes(program);
    expect(isInferredTypeOnlyAssertionImport(declaration, program, scopes, {})).toBe(false);
    expect(
      isInferredTypeOnlyAssertionImport(declaration, program, scopes, {
        allowNamedTypeReferences: true,
      }),
    ).toBe(true);
    expect(
      isInferredTypeOnlyAssertionImport(declaration, program, scopes, {
        allowNamedTypeReferences: true,
        verbatimModuleSyntax: true,
      }),
    ).toBe(false);
  });

  it("retains the same module when the imported binding is also read at runtime", () => {
    const program = parseProgram(`
      import { Shape } from "./shape";
      type Local = { label: string } & Shape;
      console.log(Shape);
    `);
    if (!isNodeOfType(program, "Program")) throw new Error("Expected Program");
    const declaration = program.body[0];
    if (!isNodeOfType(declaration, "ImportDeclaration")) throw new Error("Expected import");
    expect(
      isInferredTypeOnlyAssertionImport(declaration, program, analyzeScopes(program), {
        allowNamedTypeReferences: true,
      }),
    ).toBe(false);
  });
});

const configSource = `
  import { defineConfig, loadEnv } from "vite";
  import react from "@vitejs/plugin-react";
  import paths from "vite-tsconfig-paths";
  import svg from "vite-plugin-svgr";
  import { visualizer } from "rollup-plugin-visualizer";
  export default defineConfig(({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    return {
      plugins: [react(), paths(), svg(), visualizer({ open: process.env.ANALYZE === "true" })],
      define: { "process.env": process.env }, server: { port: 3179 }, build: { outDir: "build" }
    };
  });
`;
const makeStylesheet = () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plain-css-proof-"));
  temporaryDirectories.push(projectRoot);
  const filename = path.join(projectRoot, "owned.css");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ private: true }));
  fs.writeFileSync(filename, "body { color: rgb(19, 37, 53); margin: 3px; }");
  return { projectRoot, filename, configProgram: parseProgram(configSource) };
};

describe("plain CSS remains a separately qualified data edge", () => {
  it("accepts flat declarations without executing a stylesheet", () => {
    expect(readStandaloneVitePlainCss(makeStylesheet())?.requiresSeparateStockViteCssPipeline).toBe(
      true,
    );
  });

  it.each([
    '@import "./other.css";',
    "body { background: url(./image.png); }",
    "body { color: var(--external-color); }",
    "body { color: r\\65 d; }",
  ])("rejects an unresolved CSS edge: %s", (source) => {
    const input = makeStylesheet();
    fs.writeFileSync(input.filename, source);
    expect(readStandaloneVitePlainCss(input)).toBeNull();
  });

  it("refuses a PostCSS configuration by presence without executing its body", () => {
    const input = makeStylesheet();
    fs.writeFileSync(
      path.join(input.projectRoot, ".postcssrc.cjs"),
      'throw new Error("must not run");',
    );
    expect(readStandaloneVitePlainCss(input)).toBeNull();
  });
});
