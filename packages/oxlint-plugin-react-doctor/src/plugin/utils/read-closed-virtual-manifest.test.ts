import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readClosedVirtualManifest } from "./read-closed-virtual-manifest.js";

const MANIFEST = `
  export var PaletteRecords = [
    { slug: "storm", tags: ["cool", null] },
    { slug: "ash", tags: [] },
  ];
`;
const ENTRY = `
  export * from "./manifest.mjs";
  export * from "./swatch.mjs";
  export * from "./theme.mjs";
`;
const LEAF_MODULES = {
  "/manifest.mjs": MANIFEST,
  "/swatch.mjs": `
    import React from "react";
    import { ToneContext } from "./theme.mjs";
    export function ToneBadge() { return React.createElement("span", null, ToneContext); }
    export function ToneGrid() { return React.createElement("section"); }
  `,
  "/theme.mjs": `
    import React from "react";
    export const defaultTone = { contrast: 1 };
    export const ToneContext = React.createContext(defaultTone);
  `,
};

const readIds = (sources: Readonly<Record<string, string>>) => {
  const modules = new Map<string, SourceProjectModule>();
  for (const [filePath, source] of Object.entries(sources)) {
    const { program, errors } = parseFixture(source, { filename: filePath });
    expect(errors).toEqual([]);
    if (!isNodeOfType(program, "Program")) throw new Error("Expected a fixture program");
    attachParentReferences(program);
    modules.set(filePath, { filePath, programNode: program, scopes: analyzeScopes(program) });
  }
  const entry = modules.get("/entry.mjs");
  if (!entry) throw new Error("Expected a fixture entry");
  return (
    readClosedVirtualManifest({
      entry,
      exportedName: "PaletteRecords",
      idProperty: "slug",
      resolveLocalModule: (from, specifier) =>
        modules.get(path.posix.resolve(path.posix.dirname(from.filePath), specifier)) ?? null,
    })?.ids ?? null
  );
};

describe("readClosedVirtualManifest", () => {
  it("preserves the order of IDs from an emitted literal export", () => {
    expect(readIds({ "/entry.mjs": MANIFEST })).toEqual(["storm", "ash"]);
  });

  it("censuses all star exports and resolves ordinary sibling imports", () => {
    expect(readIds({ "/entry.mjs": ENTRY, ...LEAF_MODULES })).toEqual(["storm", "ash"]);
  });

  it("admits guarded React context creation from an inert default", () => {
    expect(
      readIds({
        ...LEAF_MODULES,
        "/entry.mjs": ENTRY,
        "/theme.mjs": `
          import React from "react";
          export var defaultTone = { contrast: undefined };
          export var ToneContext = React.createContext && React.createContext(defaultTone);
        `,
      }),
    ).toEqual(["storm", "ash"]);
  });

  it.each([
    ["an unresolved star edge", 'export * from "./missing.mjs";'],
    ["a duplicate star export", 'export * from "./manifest.mjs"; export * from "./copy.mjs";'],
    ["an export cycle", 'export * from "./loop.mjs"; export * from "./manifest.mjs";'],
  ])("refuses %s", (_name, source) => {
    expect(
      readIds({
        ...LEAF_MODULES,
        "/entry.mjs": source,
        "/copy.mjs": MANIFEST,
        "/loop.mjs": 'export * from "./entry.mjs";',
      }),
    ).toBeNull();
  });

  it.each([
    ["an ambiguous sibling export", "export const defaultTone = 0;"],
    [
      "a sibling importing the manifest",
      'import { PaletteRecords as colours } from "./manifest.mjs"; export const tones = colours;',
    ],
    [
      "an unresolved named sibling import",
      'import { missingTone } from "./theme.mjs"; export const tones = missingTone;',
    ],
    [
      "a sibling with an opaque loader",
      'export function loadTones() { return import("./manifest.mjs"); }',
    ],
    ["a sibling accessing a manifest member", "export const tones = someNamespace.PaletteRecords;"],
    [
      "an unexported initializer replacing an intrinsic",
      "const overwrite = (globalThis.RegExp = replacement);",
    ],
    [
      "an exported initializer calling an opaque function",
      "export const overwrite = replaceIntrinsic();",
    ],
    [
      "a locally defined substitute for React context creation",
      "const React = { createContext() {} }; export const ctx = React.createContext({});",
    ],
    [
      "an opaque context default",
      'import React from "react"; export const ctx = React.createContext(makeDefault());',
    ],
    [
      "a renderer reaching an ambient intrinsic",
      "export function Draw() { window.RegExp = replacement; }",
    ],
    [
      "a renderer calling an opaque callback",
      "export function Draw(props) { return props.render(); }",
    ],
    [
      "a renderer calling a local alias of an opaque callback",
      "export function Draw(props) { const render = props.render; return render(); }",
    ],
    [
      "a renderer applying an opaque callback",
      "export function Draw(props) { return props.render.apply(null, []); }",
    ],
    [
      "a renderer invoking an opaque tag",
      "export function Draw(props) { return props.render`item`; }",
    ],
    [
      "a renderer reaching the constructor through a dynamic key",
      'export function Draw() { var key = "con" + "structor"; const data = {}; return data[key]; }',
    ],
    [
      "a renderer using an inherited enumerated property",
      "export function Draw(data) { for (var key in data) { return data[key]; } }",
    ],
  ])("refuses %s", (_name, source) => {
    expect(readIds({ ...LEAF_MODULES, "/entry.mjs": ENTRY, "/swatch.mjs": source })).toBeNull();
  });

  it.each([
    ["an unsafe ID", '[{ slug: "../storm" }]'],
    ["a duplicate ID", '[{ slug: "storm" }, { slug: "storm" }]'],
    ["a getter", '[{ get slug() { return "storm"; } }]'],
    ["a spread field", '[{ ...metadata, slug: "storm" }]'],
    ["a non-data sibling field", '[{ slug: "storm", metadata: makeMetadata() }]'],
  ])("refuses %s in a manifest record", (_name, initializer) => {
    expect(readIds({ "/entry.mjs": `export const PaletteRecords = ${initializer};` })).toBeNull();
  });
});
