import { defineRule } from "../../utils/define-rule.js";
import { r3fRequireOwnedTextureCleanup } from "./r3f-require-owned-texture-cleanup.js";

export const threeRequireOwnedTextureCleanup = defineRule({
  id: "three-require-owned-texture-cleanup",
  title: "Locally owned Three.js texture is not disposed",
  category: "Performance",
  severity: "warn",
  disabledWhen: ["r3f"],
  recommendation: "Dispose locally constructed textures when their React owner releases them",
  create: r3fRequireOwnedTextureCleanup.create,
});
