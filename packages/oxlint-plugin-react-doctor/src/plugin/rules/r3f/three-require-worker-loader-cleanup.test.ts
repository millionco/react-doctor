import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireWorkerLoaderCleanup } from "./three-require-worker-loader-cleanup.js";

describe("three-require-worker-loader-cleanup", () => {
  it("reports component-owned worker loaders without cleanup", () => {
    const code = `
      import { useMemo } from "react";
      import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
      import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
      export const Scene = () => {
        const draco = useMemo(() => new DRACOLoader(), []);
        const ktx = useMemo(() => new KTX2Loader(), []);
        return null;
      };
    `;
    expect(runRule(threeRequireWorkerLoaderCleanup, code).diagnostics).toHaveLength(2);
  });

  it("allows matching cleanup, module-owned, escaped, and unrelated loaders", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
      import { KTX2Loader as Other } from "texture-kit";
      const shared = new DRACOLoader();
      export const Scene = ({ adopt }) => {
        const loader = useMemo(() => new DRACOLoader(), []);
        useEffect(() => () => loader.dispose(), [loader]);
        const escaped = useMemo(() => new DRACOLoader(), []);
        adopt(escaped);
        const unrelated = useMemo(() => new Other(), []);
        return null;
      };
    `;
    expect(runRule(threeRequireWorkerLoaderCleanup, code).diagnostics).toHaveLength(0);
  });
});
