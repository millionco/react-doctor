import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { isNonReactJsxSource } from "../src/react-cleanup/utils/is-non-react-jsx-source.js";

const parseTsx = (sourceText: string): ts.SourceFile =>
  ts.createSourceFile("component.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

describe("isNonReactJsxSource", () => {
  it.each([
    [
      "solid runtime import",
      `import { createSignal } from "solid-js";\nexport const A = () => <div />;`,
    ],
    [
      "solid subpath import",
      `import { render } from "solid-js/web";\nexport const A = () => <div />;`,
    ],
    [
      "qwik import",
      `import { component$ } from "@builder.io/qwik";\nexport const A = () => <div />;`,
    ],
    ["voby import", `import { $ } from "voby";\nexport const A = () => <div />;`],
    ["side-effect import", `import "solid-js";\nexport const A = () => <div />;`],
    [
      "escaped module specifier",
      `import { createSignal } from "solid\\u002djs";\nexport const A = () => <div />;`,
    ],
    ["classList object literal", `export const A = () => <div classList={{ active: true }} />;`],
    ["class: namespaced attribute", `export const A = () => <div class:active={true} />;`],
    ["bind: namespaced attribute", `export const A = () => <input bind:value={value} />;`],
    ["spaced namespaced attribute", `export const A = () => <div class : active={true} />;`],
    [
      "marker deep in tree",
      `export const A = () => (\n  <main>\n    <section>\n      <span classList={{ a: true }} />\n    </section>\n  </main>\n);`,
    ],
  ])("detects %s", (_label, sourceText) => {
    expect(isNonReactJsxSource(parseTsx(sourceText))).toBe(true);
  });

  it.each([
    [
      "plain react component",
      `import { useState } from "react";\nexport const A = () => <div className="a" />;`,
    ],
    ["no imports", `export const A = () => <div className="a" />;`],
    [
      "react import alongside solid marker",
      `import React from "react";\nimport { createSignal } from "solid-js";\nexport const A = () => <div />;`,
    ],
    [
      "preact import alongside classList",
      `import { h } from "preact";\nexport const A = () => <div classList={{ a: true }} />;`,
    ],
    [
      "type-only solid import",
      `import type { Component } from "solid-js";\nexport const A = () => <div />;`,
    ],
    [
      "type-only named solid import",
      `import { type Component } from "solid-js";\nexport const A = () => <div />;`,
    ],
    ["solid mentioned in a comment", `// migrated from solid-js\nexport const A = () => <div />;`],
    ["solid mentioned in a string", `export const A = () => <div title="solid-js" />;`],
    [
      "classList as a DOM property",
      `export const A = () => <div ref={(node) => node?.classList.add("a")} />;`,
    ],
    ["classList with non-object initializer", `export const A = () => <div classList={names} />;`],
    ["class: in a string literal", `export const A = () => <div data-x="class: foo" />;`],
    [
      "bind: in an object literal",
      `const options = { bind: true };\nexport const A = () => <div />;`,
    ],
    [
      "conditional type with class keyword",
      `type X<T> = T extends { class: string } ? 1 : 0;\nexport const A = () => <div />;`,
    ],
    [
      "dynamic solid import only",
      `const load = () => import("solid-js");\nexport const A = () => <div />;`,
    ],
  ])("keeps %s as React", (_label, sourceText) => {
    expect(isNonReactJsxSource(parseTsx(sourceText))).toBe(false);
  });
});
