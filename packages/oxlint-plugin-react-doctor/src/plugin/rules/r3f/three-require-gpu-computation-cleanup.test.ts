import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireGpuComputationCleanup } from "./three-require-gpu-computation-cleanup.js";

describe("three-require-gpu-computation-cleanup", () => {
  it("reports a component-owned computation renderer without cleanup", () => {
    const code = `
      import { useEffect } from "react";
      import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js";
      const Scene = ({ renderer }) => {
        useEffect(() => {
          const computation = new GPUComputationRenderer(64, 64, renderer);
          computation.init();
          computation.compute();
        }, [renderer]);
        return null;
      };
    `;

    expect(runRule(threeRequireGpuComputationCleanup, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useEffect } from "react"; import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const Scene = ({ renderer }) => { useEffect(() => { const computation = new GPUComputationRenderer(64, 64, renderer); return () => computation.dispose(); }, [renderer]); return null; };`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(64, 64, renderer);`,
    `import { useEffect } from "react"; import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const Scene = ({ renderer, own }) => { useEffect(() => { const computation = new GPUComputationRenderer(64, 64, renderer); own(computation); }, [renderer, own]); return null; };`,
    `import { useEffect } from "react"; import { GPUComputationRenderer } from "other"; const Scene = ({ renderer }) => { useEffect(() => { new GPUComputationRenderer(64, 64, renderer); }, [renderer]); return null; };`,
  ])("keeps cleaned, module-owned, transferred, and unrelated resources quiet", (code) => {
    expect(runRule(threeRequireGpuComputationCleanup, code).diagnostics).toHaveLength(0);
  });
});
