import { defineRule } from "../../utils/define-rule.js";
import { createOwnedThreeResourceCleanupVisitors } from "./utils/create-owned-three-resource-cleanup-visitors.js";

export const threeRequireOwnedGeometryCleanup = defineRule({
  id: "three-require-owned-geometry-cleanup",
  title: "Locally owned Three.js geometry is not disposed",
  category: "Performance",
  severity: "warn",
  recommendation: "Dispose locally constructed geometries when their React owner releases them",
  create: (context) =>
    createOwnedThreeResourceCleanupVisitors({
      constructorNameSuffix: "Geometry",
      context,
      message:
        "This locally constructed Three.js geometry owns GPU buffers but has no provable React cleanup. Dispose it when the owning component or hook releases it",
    }),
});
