import { describe, expect, it } from "vite-plus/test";
import { STATIC_VIRTUAL_MODULE_MAX_IDS } from "../constants/thresholds.js";
import { isStaticVirtualModuleSwitch } from "./is-static-virtual-module-switch.js";
import type { StaticAstroVirtualModuleRequirement } from "./read-static-astro-virtual-module-requirement.js";

const RECIPE: StaticAstroVirtualModuleRequirement = {
  virtualSource: "virtual:read-colors",
  manifestSource: "@sample/color-data",
  manifestExportName: "palette",
  idProperty: "id",
  prologue: "export function readColor(color) { switch (color) {",
  caseQuasis: ['case "', '": return import("@sample/color-data/', '");'],
  epilogue: "} };",
};

describe("isStaticVirtualModuleSwitch", () => {
  it("accepts only the verified same-package import for each ID", () => {
    expect(isStaticVirtualModuleSwitch(RECIPE, ["amber", "jade"])).toBe(true);
    expect(
      isStaticVirtualModuleSwitch({ ...RECIPE, manifestSource: "@sample/color-data/meta" }, [
        "amber",
      ]),
    ).toBe(true);
  });

  it.each([
    { name: "empty", ids: [] },
    { name: "duplicated", ids: ["amber", "amber"] },
    { name: "source syntax", ids: ['amber"; import("./page");'] },
    { name: "parent path", ids: ["../jade"] },
    { name: "uppercase", ids: ["Jade"] },
    {
      name: "over the limit",
      ids: Array.from({ length: STATIC_VIRTUAL_MODULE_MAX_IDS + 1 }, (_, index) => `tone${index}`),
    },
  ])("rejects an unsafe ID set: $name", ({ ids }) => {
    expect(isStaticVirtualModuleSwitch(RECIPE, ids)).toBe(false);
  });

  it.each<Partial<StaticAstroVirtualModuleRequirement>>([
    { caseQuasis: ['case "', '": return import("./', '");'] },
    { caseQuasis: ['case "', '": return import("foreign-data/', '");'] },
    { caseQuasis: ['case "', '": return import("@sample/color-data/', '", options());'] },
    { caseQuasis: ['case "', '": remember(color); return import("@sample/color-data/', '");'] },
    { epilogue: "default: return import('./page'); } };" },
    { epilogue: "} }; register(readColor);" },
    { prologue: 'const other = "amber"; export function readColor(color) { switch (other) {' },
  ])("rejects a recipe with an unproven runtime surface: %j", (replacement) => {
    expect(isStaticVirtualModuleSwitch({ ...RECIPE, ...replacement }, ["amber"])).toBe(false);
  });
});
