import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { noUnknownProperty } from "./no-unknown-property.js";

const STENCIL_COMPONENT = `
  import { Component, h } from "@stencil/core";
  @Component({ tag: "demo-panel" })
  export class DemoPanel {
    private renderContent() {
      return <div class="content" htmlfor="still-checked" />;
    }
    render() {
      return <section class="panel">{this.renderContent()}</section>;
    }
  }
`;
const CLASSIC_STENCIL_OPTIONS = { jsx: "react", jsxFactory: "h" };

let directory: string;
let filename: string;
let configPath: string;

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stencil-class-property-")));
  const sourceDirectory = path.join(directory, "src");
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(path.join(directory, ".git"));
  filename = path.join(sourceDirectory, "component.tsx");
  configPath = path.join(directory, "tsconfig.json");
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const writeClassicStencilConfig = (): void =>
  fs.writeFileSync(configPath, JSON.stringify({ compilerOptions: CLASSIC_STENCIL_OPTIONS }));

const diagnosticsFor = (sourceText: string): ReturnType<typeof runRule>["diagnostics"] => {
  const result = runRule(noUnknownProperty, sourceText, { filename, includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("class attributes on Stencil JSX", () => {
  it("accepts class on host elements in a Stencil-owned method, keeping other property diagnostics", () => {
    writeClassicStencilConfig();
    const diagnostics = diagnosticsFor(STENCIL_COMPONENT);
    expect(diagnostics.map(({ line }) => line)).toEqual([6]);
  });

  it("keeps intrinsic class warnings in upstream mode", () => {
    writeClassicStencilConfig();
    const result = runRule(noUnknownProperty, STENCIL_COMPONENT, {
      filename,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "upstream" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map(({ line }) => line)).toEqual([6, 6, 9]);
  });

  it("keeps class warnings in JSX outside the Stencil class", () => {
    writeClassicStencilConfig();
    const diagnostics = diagnosticsFor(
      STENCIL_COMPONENT + '\nexport const Ordinary = () => <div class="outside" />;',
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[1]?.line).toBe(13);
  });

  it("keeps warnings when a real React runtime import coexists with Stencil imports", () => {
    writeClassicStencilConfig();
    const diagnostics = diagnosticsFor(
      'import React from "react";\n' +
        STENCIL_COMPONENT +
        '\nexport const Ordinary = () => <div class="outside" />;',
    );
    expect(diagnostics).toHaveLength(4);
  });

  it("keeps ordinary React and local decorator lookalikes", () => {
    writeClassicStencilConfig();
    expect(diagnosticsFor('export const Plain = () => <div class="typo" />;')).toHaveLength(1);
    expect(
      diagnosticsFor(
        STENCIL_COMPONENT.replace(
          'import { Component, h } from "@stencil/core";',
          'import { h } from "@stencil/core"; const Component = (options: unknown) => () => options;',
        ),
      ),
    ).toHaveLength(3);
  });

  it("keeps warnings if the required h binding is absent, erased, or shadowed", () => {
    writeClassicStencilConfig();
    expect(diagnosticsFor(STENCIL_COMPONENT.replace("Component, h", "Component"))).toHaveLength(3);
    expect(
      diagnosticsFor(STENCIL_COMPONENT.replace("Component, h", "Component, type h")),
    ).toHaveLength(3);
    expect(
      diagnosticsFor(
        STENCIL_COMPONENT.replace("renderContent()", "renderContent(h = otherFactory)"),
      ),
    ).toHaveLength(2);
  });

  it("keeps warnings for missing, conflicting or explicitly overridden JSX config", () => {
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    writeClassicStencilConfig();
    expect(diagnosticsFor("/** @jsx React.createElement */\n" + STENCIL_COMPONENT)).toHaveLength(3);
  });

  it("follows relative config inheritance and refreshes Stencil files when config discovery can change", () => {
    const parentConfig = path.join(directory, "base.json");
    const nestedConfig = path.join(path.dirname(filename), "tsconfig.json");
    fs.writeFileSync(parentConfig, JSON.stringify({ compilerOptions: CLASSIC_STENCIL_OPTIONS }));
    fs.writeFileSync(configPath, JSON.stringify({ extends: "./base.json" }));
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
    const probes = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: STENCIL_COMPONENT,
      ruleIds: ["no-unknown-property"],
    });
    expect(probes).toBeNull();

    fs.writeFileSync(
      nestedConfig,
      JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "React.createElement" } }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it("keeps warnings for malformed nearer configs and unsupported extends", () => {
    writeClassicStencilConfig();
    const nearerConfig = path.join(path.dirname(filename), "tsconfig.json");
    fs.writeFileSync(nearerConfig, "{");
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    fs.writeFileSync(
      nearerConfig,
      JSON.stringify({ extends: "unknown/tsconfig", compilerOptions: CLASSIC_STENCIL_OPTIONS }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it.each([
    { include: ["src/**/*.tsx"], exclude: ["src/component.tsx"] },
    { files: ["src/another.tsx"] },
    { include: ["stencil/**/*.tsx"] },
    { include: ["src"], exclude: ["src/**/component*.tsx"] },
  ])("keeps warnings when the nearest classic config cannot prove file membership", (selection) => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compilerOptions: CLASSIC_STENCIL_OPTIONS, ...selection }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it("keeps explicit files and inherited include patterns relative to their declaring config", () => {
    const configsDirectory = path.join(directory, "configs");
    fs.mkdirSync(configsDirectory);
    const baseConfig = path.join(configsDirectory, "base.json");
    fs.writeFileSync(configPath, JSON.stringify({ extends: "./configs/base.json" }));
    fs.writeFileSync(
      baseConfig,
      JSON.stringify({
        compilerOptions: CLASSIC_STENCIL_OPTIONS,
        include: ["src/**/*.tsx"],
      }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    fs.writeFileSync(
      baseConfig,
      JSON.stringify({
        compilerOptions: CLASSIC_STENCIL_OPTIONS,
        include: ["../src/**/*.tsx"],
      }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
    fs.writeFileSync(
      baseConfig,
      JSON.stringify({
        compilerOptions: CLASSIC_STENCIL_OPTIONS,
        files: ["../src/component.tsx"],
      }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
    fs.writeFileSync(configPath, JSON.stringify({ extends: "./configs/base.json", files: [] }));
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it("keeps warnings in dot directories excluded by wildcard membership but respects explicit files", () => {
    const hiddenDirectory = path.join(path.dirname(filename), ".hidden");
    fs.mkdirSync(hiddenDirectory);
    filename = path.join(hiddenDirectory, "component.tsx");
    const writeSelection = (selection: Record<string, unknown>): void =>
      fs.writeFileSync(
        configPath,
        JSON.stringify({ compilerOptions: CLASSIC_STENCIL_OPTIONS, ...selection }),
      );
    writeSelection({ include: ["src/**/*.tsx"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    writeSelection({ include: ["src/.hidden/**/*.tsx"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
    writeSelection({ files: ["src/.hidden/component.tsx"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
  });

  it("honors TypeScript extension precedence only when the higher-priority file is selected", () => {
    fs.writeFileSync(path.join(path.dirname(filename), "component.ts"), "export {};");
    const writeSelection = (selection: Record<string, unknown>): void =>
      fs.writeFileSync(
        configPath,
        JSON.stringify({ compilerOptions: CLASSIC_STENCIL_OPTIONS, ...selection }),
      );
    writeSelection({ include: ["src/**/*"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    writeSelection({ include: ["src/**/*.tsx"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
    writeSelection({ files: ["src/component.ts"], include: ["src/**/*.tsx"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    writeSelection({ files: ["src/component.tsx"], include: ["src/**/*"] });
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
  });

  it("retains warnings when another detectable project can compile the source with React JSX", () => {
    writeClassicStencilConfig();
    const alternateConfig = path.join(directory, "tsconfig.build.json");
    fs.writeFileSync(alternateConfig, JSON.stringify({ extends: "./tsconfig.json" }));
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
    fs.writeFileSync(
      alternateConfig,
      JSON.stringify({
        extends: "./tsconfig.json",
        compilerOptions: { jsx: "react-jsx", jsxFactory: null },
      }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it("keeps warnings when an ancestor solution names another build project", () => {
    fs.writeFileSync(
      path.join(path.dirname(filename), "tsconfig.json"),
      JSON.stringify({ compilerOptions: CLASSIC_STENCIL_OPTIONS }),
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({ files: [], references: [{ path: "./src/other-project.json" }] }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it.each(["configs/build.json", "configs"])(
    "checks the literal project selected by a package script outside the source ancestors",
    (projectPath) => {
      writeClassicStencilConfig();
      const projectDirectory = path.join(directory, "configs");
      fs.mkdirSync(projectDirectory);
      const scriptConfig = path.join(
        directory,
        projectPath === "configs" ? "configs/tsconfig.json" : projectPath,
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ scripts: { build: `tsc --noEmit -p "${projectPath}"` } }),
      );
      fs.writeFileSync(scriptConfig, JSON.stringify({ extends: "../tsconfig.json" }));
      expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(1);
      fs.writeFileSync(
        scriptConfig,
        JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, files: ["../src/component.tsx"] }),
      );
      expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
    },
  );

  it("keeps warnings when a package script chooses its TypeScript project dynamically", () => {
    writeClassicStencilConfig();
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ scripts: { build: 'tsc -p "$BUILD_CONFIG"' } }),
    );
    expect(diagnosticsFor(STENCIL_COMPONENT)).toHaveLength(3);
  });

  it("does not probe config for ordinary React files or unrelated Stencil imports", () => {
    writeClassicStencilConfig();
    for (const sourceText of [
      'import React from "react"; const Example = () => <div class="typo" />;',
      'import { Prop } from "@stencil/core"; const Example = () => <div class="typo" />;',
      'import { Component, h } from "@stencil/core"; const Example = () => <div class="typo" />;',
    ]) {
      const probes = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText,
        ruleIds: ["no-unknown-property"],
      });
      expect(probes?.contentPaths.size).toBe(0);
    }
  });
});
