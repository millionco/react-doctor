import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStaticAstroVirtualModuleRequirement } from "./read-static-astro-virtual-module-requirement.js";

const CONFIG = `
  import { defineConfig as configure } from "astro/config";
  import adapter from "@astrojs/react";
  import { entries as catalogue } from "@demo/palette/registry";

  export default configure({
    base: "/palette/",
    trailingSlash: "ignore",
    integrations: [adapter()],
    vite: { plugins: [makePalettePlugin()] },
  });

  function makePalettePlugin() {
    const publicName = "virtual:palette";
    const internalName = "\\0" + publicName;
    return {
      name: "palette",
      resolveId(candidate: string) {
        if (candidate === publicName) {
          return internalName;
        }
        return undefined;
      },
      load(candidate: string) {
        if (candidate === internalName) {
          let chunk = "export function readTone(token) { switch (token) {";
          for (const entry of catalogue) {
            chunk += \`case "\${entry.slug}": return import("@demo/palette/\${entry.slug}");\`;
          }
          chunk += "}}";
          return chunk;
        }
        return undefined;
      },
    };
  }
`;

const readRequirement = (source: string) => {
  const filePath = "astro.config.ts";
  const { program, errors } = parseFixture(source, { filename: filePath });
  expect(errors).toEqual([]);
  if (!isNodeOfType(program, "Program")) throw new Error("Expected a fixture program");
  attachParentReferences(program);
  return readStaticAstroVirtualModuleRequirement({
    filePath,
    programNode: program,
    scopes: analyzeScopes(program),
  });
};

describe("readStaticAstroVirtualModuleRequirement", () => {
  it("returns the binding-checked manifest requirement and recipe", () => {
    expect(readRequirement(CONFIG)).toEqual({
      virtualSource: "virtual:palette",
      manifestSource: "@demo/palette/registry",
      manifestExportName: "entries",
      idProperty: "slug",
      prologue: "export function readTone(token) { switch (token) {",
      caseQuasis: ['case "', '": return import("@demo/palette/', '");'],
      epilogue: "}}",
    });
  });

  it("leaves interpretation of generated source to the next stage", () => {
    const source = CONFIG.replace(
      "export function readTone(token) { switch (token) {",
      "sideEffect();",
    );
    expect(readRequirement(source)?.prologue).toBe("sideEffect();");
  });

  it.each([
    ["a spoofed config import", 'from "astro/config"', 'from "foreign/config"'],
    ["a type-only manifest import", "{ entries as catalogue }", "{ type entries as catalogue }"],
    ["an extra plugin", "[makePalettePlugin()]", "[makePalettePlugin(), anotherPlugin()]"],
    ["a Vite alias", "vite: { plugins:", "vite: { resolve: { alias: {} }, plugins:"],
    ["a wildcard resolver", "candidate === publicName", "candidate.startsWith(publicName)"],
    ["a resolver fallback that can redirect", "return undefined;", "return candidate;"],
    ["an extra loader operation", "return chunk;", "publish(chunk); return chunk;"],
    ["a different manifest field", "${entry.slug}", "${entry.caption}"],
    ["a different template binding", "${entry.slug}", "${other.slug}"],
  ])("refuses %s", (_name, before, after) => {
    const source = CONFIG.replace(before, after);
    expect(source).not.toBe(CONFIG);
    expect(readRequirement(source)).toBeNull();
  });
});
