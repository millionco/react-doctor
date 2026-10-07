import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeOnBeforeCompileRequireProgramCacheKey } from "./three-on-before-compile-require-program-cache-key.js";

describe("three-on-before-compile-require-program-cache-key", () => {
  it.each([
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = (shader) => {
       if (mode === "warm") shader.fragmentShader = shader.fragmentShader.replace("A", "B");
     };`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       const patch = mode === "warm" ? "B" : "C";
       shader.fragmentShader = shader.fragmentShader.replace("A", patch);
     };`,
    `import { MeshStandardMaterial } from "three";
     const options = { mode: "warm" };
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       const selectedMode = options.mode;
       const patch = \`#define MODE_\${selectedMode}\\n\`;
       shader.vertexShader = patch + shader.vertexShader;
     };`,
    `import { MeshStandardMaterial } from "three";
     let enabled = true;
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       let shouldPatch = enabled;
       if (shouldPatch) shader.fragmentShader += " ";
     };`,
    `import * as THREE from "three";
     const options = { useFog: true };
     const material = new THREE.MeshPhongMaterial();
     material.onBeforeCompile = shader => {
       shader.vertexShader = options.useFog ? "#define FOG\\n" + shader.vertexShader : shader.vertexShader;
     };`,
    `import { MeshStandardMaterial } from "three";
     let enabled = true;
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       enabled && (shader.fragmentShader += " ");
     };`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       switch (mode) {
         case "warm":
           shader.fragmentShader += " ";
         break;
       }
     };`,
    `import { MeshStandardMaterial } from "three";
     let remaining = 1;
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       while (remaining > 0) {
         shader.fragmentShader += " ";
         remaining -= 1;
       }
     };`,
    `import { MeshStandardMaterial } from "three";
     let chunks = ["A"];
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       for (const chunk of chunks) shader.fragmentShader += chunk;
     };`,
    `import { MeshStandardMaterial } from "three";
     let defines = { MODE: "A" };
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       for (const name in defines) shader.defines[name] = defines[name];
     };`,
    `import { MeshStandardMaterial } from "three";
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = function (shader) {
       if (this.mode === "warm") shader.fragmentShader += " ";
     };`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     new MeshStandardMaterial({
       customProgramCacheKey: null,
       onBeforeCompile: shader => {
         if (mode === "warm") shader.fragmentShader += " ";
       },
     });`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       if (mode === "warm") shader.fragmentShader += " ";
     };
     material.customProgramCacheKey = "warm";`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     const material = new MeshStandardMaterial();
     material.customProgramCacheKey = () => mode;
     material.customProgramCacheKey = null;
     material.onBeforeCompile = shader => {
       if (mode === "warm") shader.fragmentShader += " ";
     };`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     const material = new MeshStandardMaterial({
       customProgramCacheKey: () => mode,
       onBeforeCompile: shader => {
         if (mode === "warm") shader.fragmentShader += " ";
       },
     });
     material.customProgramCacheKey = null;`,
    `import { MeshStandardMaterial } from "three";
     const createMaterial = (mode) => {
       const material = new MeshStandardMaterial();
       material.onBeforeCompile = shader => {
         if (mode === "warm") shader.fragmentShader += " ";
       };
       return material;
     };
     createMaterial("warm");`,
    `import { MeshStandardMaterial } from "three";
     const chunks = ["A"];
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       for (const chunk of chunks) shader.fragmentShader += chunk;
     };`,
    `import { MeshStandardMaterial } from "three";
     const defines = { MODE: "A" };
     const material = new MeshStandardMaterial();
     material.onBeforeCompile = shader => {
       for (const name in defines) shader.defines[name] = defines[name];
     };`,
    `import { MeshStandardMaterial } from "three";
     let mode = "warm";
     let material = new MeshStandardMaterial({
       onBeforeCompile: shader => {
         if (mode === "warm") shader.fragmentShader += " ";
       },
     });
     material = new MeshStandardMaterial();
     material.customProgramCacheKey = () => mode;`,
  ])("reports mutable program variants without a cache key", (code) => {
    expect(runRule(threeOnBeforeCompileRequireProgramCacheKey, code).diagnostics).toHaveLength(1);
  });

  it("reports a variant-dependent constructor callback without a cache key", () => {
    const code = `import { MeshStandardMaterial } from "three";
      let mode = "warm";
      new MeshStandardMaterial({
        onBeforeCompile: shader => {
          if (mode === "warm") shader.fragmentShader += " ";
        },
      });`;

    expect(runRule(threeOnBeforeCompileRequireProgramCacheKey, code).diagnostics).toHaveLength(1);
  });

  it("recognizes constructor cache keys for constructor and assigned callbacks", () => {
    const code = `import { MeshStandardMaterial } from "three";
      let mode = "warm";
      const material = new MeshStandardMaterial({
        customProgramCacheKey: () => mode,
        onBeforeCompile: shader => {
          if (mode === "warm") shader.fragmentShader += " ";
        },
      });
      material.onBeforeCompile = shader => {
        if (mode === "warm") shader.vertexShader += " ";
      };`;

    expect(runRule(threeOnBeforeCompileRequireProgramCacheKey, code).diagnostics).toHaveLength(0);
  });

  it.each(["let", "var"])("recognizes a cache key on an unreassigned %s material", (kind) => {
    const code = `import { MeshStandardMaterial } from "three";
      let mode = "warm";
      ${kind} material = new MeshStandardMaterial();
      material.onBeforeCompile = shader => {
        if (mode === "warm") shader.fragmentShader += " ";
      };
      material.customProgramCacheKey = () => mode;`;

    expect(runRule(threeOnBeforeCompileRequireProgramCacheKey, code).diagnostics).toHaveLength(0);
  });

  it.each([
    `import { MeshStandardMaterial } from "three"; let mode = "warm"; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { if (mode === "warm") shader.fragmentShader += " "; }; material.customProgramCacheKey = () => mode;`,
    `import { MeshStandardMaterial } from "three"; const mode = "warm"; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { if (mode === "warm") shader.fragmentShader += " "; };`,
    `import { MeshStandardMaterial } from "three"; let value = 1; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { shader.uniforms.value = { value }; };`,
    `import { MeshStandardMaterial } from "three"; let mode = "warm"; const first = new MeshStandardMaterial(); const second = new MeshStandardMaterial(); first.onBeforeCompile = shader => { if (mode === "warm") shader.fragmentShader += " "; }; second.customProgramCacheKey = () => mode;`,
    `class MeshStandardMaterial {}; let mode = "warm"; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { if (mode === "warm") shader.fragmentShader += " "; };`,
    `import { MeshStandardMaterial } from "three"; const material = new MeshStandardMaterial(); material.onBeforeCompile = patchShader;`,
    `import { MeshStandardMaterial } from "three"; import { cacheKey } from "./cache-key"; let mode = "warm"; const material = new MeshStandardMaterial({ customProgramCacheKey: cacheKey }); material.onBeforeCompile = shader => { if (mode === "warm") shader.fragmentShader += " "; };`,
    `import { MeshStandardMaterial } from "three"; let mode = "warm"; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { const patch = "static"; shader.fragmentShader += patch; };`,
    `import { MeshStandardMaterial } from "three"; let mode = "warm"; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { const patch = { source: "static", unused: mode }; shader.fragmentShader += patch.source; };`,
    `import { MeshStandardMaterial } from "three"; let mode = "warm"; const material = new MeshStandardMaterial(); material.onBeforeCompile = shader => { let patch = mode; patch = "static"; shader.fragmentShader += patch; };`,
  ])(
    "keeps keyed, stable, uniform-only, differently keyed, unrelated, and unresolved patches quiet",
    (code) => {
      const expectedCount = code.includes("const first") ? 1 : 0;
      expect(runRule(threeOnBeforeCompileRequireProgramCacheKey, code).diagnostics).toHaveLength(
        expectedCount,
      );
    },
  );
});
