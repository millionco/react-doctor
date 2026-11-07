import { describe, expect, it } from "vite-plus/test";
import { getStaticEsmPackageExportTarget } from "./get-static-esm-package-export-target.js";

const EXPECTED_TARGET = "./data/entry.mjs";

const readTarget = (manifest: unknown) =>
  getStaticEsmPackageExportTarget({ manifest, packageName: "some-colors", subpath: "./meta" });

describe("getStaticEsmPackageExportTarget", () => {
  it("reads exact direct or unambiguous ESM export entries", () => {
    expect(readTarget({ name: "some-colors", exports: { "./meta": EXPECTED_TARGET } })).toBe(
      EXPECTED_TARGET,
    );
    expect(
      readTarget({
        name: "some-colors",
        exports: {
          "./meta": {
            types: "./data/entry.d.ts",
            require: "./data/entry.cjs",
            import: EXPECTED_TARGET,
            default: EXPECTED_TARGET,
          },
        },
      }),
    ).toBe(EXPECTED_TARGET);
  });

  it.each([
    { name: "other-colors", exports: { "./meta": EXPECTED_TARGET } },
    { name: "some-colors", exports: { "./*": "./data/*.mjs" } },
    { name: "some-colors", exports: { "./meta": [EXPECTED_TARGET] } },
    { name: "some-colors", exports: { "./meta": "./../entry.mjs" } },
    { name: "some-colors", exports: { "./meta": "./node_modules/other/entry.mjs" } },
    {
      name: "some-colors",
      browser: { [EXPECTED_TARGET]: "./other.mjs" },
      exports: { "./meta": EXPECTED_TARGET },
    },
    {
      name: "some-colors",
      exports: { "./meta": { default: "./other.mjs", import: EXPECTED_TARGET } },
    },
    {
      name: "some-colors",
      exports: { "./meta": { development: "./other.mjs", import: EXPECTED_TARGET } },
    },
  ])("rejects ambiguous or escaping export targets: %j", (manifest) => {
    expect(readTarget(manifest)).toBeNull();
  });
});
