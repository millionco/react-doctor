import { describe, expect, it } from "vite-plus/test";
import { extractJitiLoadReferences } from "../src/project-analysis/utils/extract-jiti-load-references.js";

describe("extractJitiLoadReferences", () => {
  it("extracts static ESM and CommonJS Jiti loads", () => {
    const references = extractJitiLoadReferences(`
      import { createJiti } from "jiti";
      const esmLoader = createJiti(import.meta.url);
      esmLoader.import("./esm-import.ts");
      createJiti(import.meta.url)("./esm-inline.ts");
      const commonJsLoader = require("jiti")(__filename);
      commonJsLoader("./commonjs-loader.ts");
      require("jiti")(__filename)("./commonjs-inline.ts");
      const { createJiti: createCommonJsJiti } = require("jiti");
      const commonJsV2Loader = createCommonJsJiti(__filename);
      commonJsV2Loader.import("./commonjs-v2.ts");
    `);

    expect(references.map((reference) => reference.path)).toEqual([
      "./esm-import.ts",
      "./esm-inline.ts",
      "./commonjs-loader.ts",
      "./commonjs-inline.ts",
      "./commonjs-v2.ts",
    ]);
  });

  it("uses binding identity and records only genuine computed Jiti loads", () => {
    const references = extractJitiLoadReferences(`
      import { createJiti } from "jiti";
      import { loadModule } from "./ordinary-helper";
      const runtimeLoader = createJiti(import.meta.url);
      const ordinaryCall = (runtimeLoader) => runtimeLoader("./ordinary.ts");
      loadModule("./also-ordinary.ts");
      runtimeLoader.import(process.env.RUNTIME_MODULE);
      ordinaryCall((source) => source);
    `);

    expect(references).toHaveLength(1);
    expect(references[0].path).toBeUndefined();
  });
});
