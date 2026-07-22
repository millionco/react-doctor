import { defineRule } from "../../utils/define-rule.js";
import { createOwnedThreeResourceCleanupVisitors } from "./utils/create-owned-three-resource-cleanup-visitors.js";

export const threeRequireOwnedMaterialCleanup = defineRule({
  id: "three-require-owned-material-cleanup",
  title: "Locally owned Three.js material is not disposed",
  category: "Performance",
  severity: "warn",
  recommendation: "Dispose locally constructed materials when their React owner releases them",
  create: (context) =>
    createOwnedThreeResourceCleanupVisitors({
      constructorNameSuffix: "Material",
      context,
      message:
        "This locally constructed Three.js material owns a GPU shader program but has no provable React cleanup. Dispose it when the owning component or hook releases it",
    }),
});
