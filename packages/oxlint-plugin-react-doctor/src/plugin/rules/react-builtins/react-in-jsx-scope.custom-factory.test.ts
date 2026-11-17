import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

describe("react-in-jsx-scope custom source factories", () => {
  it.each([
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/* @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx draw */\nimport { paint as draw } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx Canvas.paint */\nimport * as Canvas from "canvas-runtime"; const View = () => <article />;`,
    `/**\n * @jsx paint\n * @jsxRuntime classic\n */\nimport paint from "canvas-runtime"; const View = () => <article />;`,
    `/**\n\t*\u00a0@jsx paint\n */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\nconst paint = makeFactory(); const View = () => <article />;`,
    `/** @jsx paint */\nconst View = (paint) => <article />;`,
    `/** @jsx Canvas.paint */\nimport Canvas = require("canvas-runtime"); const View = () => <article />;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; for (let paint = 0; paint < 1; paint++) {} const View = () => <article />;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; type paint = unknown; const View = () => <article />;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = <paint,>() => <article />;`,
    `\uFEFF/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `#!/usr/bin/env node\n/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n"use strict"; import { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** @jsxFrag Group */\nimport { paint, Group } from "canvas-runtime"; const View = () => <><article /></>;`,
    `/** @jsx Canvas.paint */\n/** @jsxFrag Canvas.Group */\nimport Canvas from "canvas-runtime"; const View = () => <><article /></>;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; import React from "react"; const View = () => <><React.Fragment /></>;`,
  ])("accepts a bound selected factory: %s", (code) => {
    const result = runRule(reactInJsxScope, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `import { paint } from "canvas-runtime"; const View = () => <article />;`,
    `// @jsx paint\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\nconst View = () => <article />;`,
    `/** @jsx paint */\nimport type { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\nimport { type paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx Canvas.paint */\nimport type Canvas = require("canvas-runtime"); const View = () => <article />;`,
    `/** @jsx paint */\ntype paint = () => unknown; const View = () => <article />;`,
    `/** @jsx paint */\nnamespace paint { export interface Marker {} } const View = () => <article />;`,
    `/** @jsx Canvas.paint */\nnamespace Canvas { export const paint = makeFactory(); } const View = () => <article />;`,
    `/** @jsx paint */\ndeclare const paint: unknown; const View = () => <article />;`,
    `/** @jsx paint */\nconst Other = (paint) => null; const View = () => <article />;`,
    `/** @jsx paint */\nfor (const paint of factories) {} const View = () => <article />;`,
    `/** @jsx paint */\n/** @jsx other */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** @JSX other */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** prose @jsx other */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n// @jsx other\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint.extra() */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint trailing-text */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** @jsxRuntime automatic */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** @jsxRuntime unknown */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\n/** @jsxImportSource canvas-runtime */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; /** @jsx other */ const View = () => <article />;`,
    `const documentation = "/** @jsx paint */"; import { paint } from "canvas-runtime"; const View = () => <article />;`,
    `"use strict"; /** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <article />;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <React.Fragment />;`,
  ])("keeps existing diagnostics outside the supported exemption: %s", (code) => {
    const result = runRule(reactInJsxScope, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves legacy quiet behavior when React is bound and the custom factory is missing", () => {
    const result = runRule(
      reactInJsxScope,
      `/** @jsx paint */\nimport React from "react"; const View = () => <article />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `/** @jsx paint */\nimport React = require("react"); const View = () => <article />;`,
    `/** @jsx paint */\nnamespace React { export const createElement = makeFactory(); } const View = () => <article />;`,
    `/** @jsx paint */\nnamespace React { export interface Marker {} } const View = () => <article />;`,
    `/** @jsx paint */\nimport type React = require("react"); const View = () => <article />;`,
    `/** @jsx paint */\nimport { paint } from "canvas-runtime"; import type React from "react"; const View = () => <React.Fragment />;`,
  ])("preserves the legacy TypeScript React lookup without certifying its runtime: %s", (code) => {
    const result = runRule(reactInJsxScope, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("checks the fragment factory separately from its bound element factory", () => {
    const result = runRule(
      reactInJsxScope,
      `/** @jsx paint */\nimport { paint } from "canvas-runtime"; const View = () => <><article /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        message: "This JSX crashes because `React` isn't in scope.",
        nodeType: "JSXOpeningFragment",
      },
    ]);
  });

  it("retains fragments whose explicit fragment factory has only a type binding", () => {
    const result = runRule(
      reactInJsxScope,
      `/** @jsx paint */\n/** @jsxFrag Group */\nimport { paint, type Group } from "canvas-runtime"; const View = () => <><article /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.nodeType).toBe("JSXOpeningFragment");
  });
});
