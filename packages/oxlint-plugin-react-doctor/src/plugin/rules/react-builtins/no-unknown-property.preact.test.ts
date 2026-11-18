import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { noUnknownProperty } from "./no-unknown-property.js";

const preactComponent =
  'import { useState } from "preact/hooks"; export const View = () => <div class={useState("demo")[0]} />;';
const viteConfig = `
  import { defineConfig } from "vite";
  import preact from "@preact/preset-vite";
  export default defineConfig({ plugins: [preact()] });
`;
const manifest = {
  dependencies: { preact: "^10.29.1" },
  devDependencies: {
    vite: "^8.0.1",
    "@preact/preset-vite": "^2.10.5",
    "vite-plugin-monkey": "^8.0.0",
  },
  scripts: { build: "vite build" },
};
const jsxOptions = { jsx: "react-jsx", jsxImportSource: "preact", noEmit: true };

describe("no-unknown-property Preact Vite ownership", () => {
  let directory: string;
  let filename: string;
  const write = (name: string, input: unknown): string => {
    const destination = path.join(directory, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(
      destination,
      typeof input === "string" ? input : JSON.stringify(input),
      "utf8",
    );
    return destination;
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-preact-jsx-"));
    filename = write("src/view.tsx", preactComponent);
    write("package.json", manifest);
    write("vite.config.ts", viteConfig);
    write("tsconfig.json", { files: [], references: [{ path: "./tsconfig.app.json" }] });
    write("tsconfig.app.json", { include: ["src"], compilerOptions: jsxOptions });
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const report = (source = preactComponent, portedRuleMode = "curated") =>
    runRule(noUnknownProperty, source, {
      filename,
      settings: {
        "react-doctor": { capabilities: ["react", "preact", "pure-preact"], portedRuleMode },
      },
    }).diagnostics;

  it.each(["curated", "upstream"])(
    "allows literal class but keeps other checks in %s mode",
    (mode) => {
      const source = preactComponent.replace("<div class=", '<div aria-bogus="true" class=');
      const unrelated = report(source.replace(" class=", " id="), mode);
      expect(unrelated).toHaveLength(1);
      expect(report(source, mode)).toEqual(unrelated);
    },
  );

  it("normalizes forward-slash host paths", () => {
    filename = filename.split(path.sep).join("/");
    expect(report()).toEqual([]);
  });

  it("uses JSX options declared in a relative extends config", () => {
    write("tsconfig.app.json", { include: ["src"], extends: "./settings/base.json" });
    write("settings/base.json", { compilerOptions: jsxOptions });
    expect(report()).toEqual([]);
  });

  it("accepts an explicit owning file through an inherited include base", () => {
    write("tsconfig.app.json", { extends: "./settings/base.json" });
    write("settings/base.json", { files: ["../src/view.tsx"], compilerOptions: jsxOptions });
    expect(report()).toEqual([]);
  });

  it.each([
    "/** @jsxImportSource react */",
    "/** @jsxRuntime classic */",
    "/** @jsx React.createElement */",
    "/** @jsxFrag React.Fragment */",
    "/** @jsxImportSource preact */\n/** @jsxImportSource react */",
    '"use client";\n/** @jsxImportSource react */',
    'import React from "react";',
    'import { jsx } from "react/jsx-runtime";',
  ])("preserves class warnings with a conflicting directive or import %s", (prefix) => {
    expect(report(prefix + "\n" + preactComponent)).toHaveLength(1);
  });

  it("allows a matching pragma and a type-only React import", () => {
    expect(
      report(
        '/** @jsxImportSource preact */\nimport type { ReactNode } from "react";\n' +
          preactComponent,
      ),
    ).toEqual([]);
  });

  it("requires an actual Preact runtime import", () => {
    expect(
      report(
        '/** @jsxImportSource preact */\nimport type { VNode } from "preact";\nexport const View = () => <div class="demo" />;',
      ),
    ).toHaveLength(1);
  });

  it.each([
    [
      "overrides JSX to React",
      "tsconfig.app.json",
      { include: ["src"], compilerOptions: { ...jsxOptions, jsxImportSource: "react" } },
    ],
    [
      "excludes the file",
      "tsconfig.app.json",
      { include: ["src"], exclude: ["src"], compilerOptions: jsxOptions },
    ],
    ["has a nearer broken config", "src/tsconfig.json", "{"],
    ["has a competing Vite config", "vite.config.mjs", "{"],
    [
      "uses an alternate Vite config",
      "package.json",
      { ...manifest, scripts: { build: "vite build --config custom.ts" } },
    ],
    [
      "aliases the declared Preact package",
      "package.json",
      { ...manifest, dependencies: { preact: "npm:react@19.2.0" } },
    ],
    [
      "overrides Vite JSX",
      "vite.config.ts",
      viteConfig.replace("plugins:", 'oxc: { jsx: { importSource: "react" } }, plugins:'),
    ],
    [
      "uses a competing JSX plugin",
      "vite.config.ts",
      viteConfig.replace("@preact/preset-vite", "@vitejs/plugin-react"),
    ],
    [
      "remaps the emitted runtime",
      "tsconfig.app.json",
      {
        include: ["src"],
        compilerOptions: { ...jsxOptions, paths: { "preact/*": ["./other/*"] } },
      },
    ],
  ])("retains the warning when the project %s", (_name, config, contents) => {
    write(config, contents);
    expect(report()).toHaveLength(1);
  });

  it("keeps external userscript code from certifying Preact ownership", () => {
    const external = `
      import monkey, { cdn } from "vite-plugin-monkey";
      ${viteConfig.replace(
        "preact()]",
        `preact(), monkey({
        entry: "src/view.tsx",
        userscript: { require: ["https://example.invalid/runtime.js"] },
        build: { externalGlobals: { preact: cdn.jsdelivr("preact", "dist/preact.min.js") } },
      })]`,
      )}
    `;
    write("vite.config.ts", external);
    expect(report()).toHaveLength(1);
  });

  it("does not treat a sibling referenced project's default include as ownership", () => {
    write("tsconfig.json", { files: [], references: [{ path: "./tools" }] });
    write("tools/tsconfig.json", { compilerOptions: jsxOptions });
    expect(report()).toHaveLength(1);
  });

  it("keeps the warning when two projects may own the file", () => {
    write("tsconfig.json", {
      files: [],
      references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.secondary.json" }],
    });
    write("tsconfig.secondary.json", {
      include: ["src"],
      compilerOptions: { ...jsxOptions, jsxImportSource: "react" },
    });
    expect(report()).toHaveLength(1);
  });

  it("tracks the package, config chain, and Vite config candidates in the lint cache", () => {
    write("tsconfig.app.json", { include: ["src"], extends: "./base" });
    write("base.json", { compilerOptions: jsxOptions });
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      ruleIds: ["no-unknown-property"],
      sourceText: preactComponent,
    });
    for (const name of [
      "src/tsconfig.json",
      "tsconfig.json",
      "tsconfig.app.json",
      "base.json",
      "package.json",
      "vite.config.ts",
      "vite.config.mjs",
    ]) {
      expect(trace?.contentPaths.has(path.join(directory, name))).toBe(true);
    }
  });
});
