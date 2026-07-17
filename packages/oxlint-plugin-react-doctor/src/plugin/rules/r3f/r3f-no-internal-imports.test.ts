import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoInternalImports } from "./r3f-no-internal-imports.js";

describe("r3f-no-internal-imports", () => {
  it("flags static, dynamic, and CommonJS private imports", () => {
    const result = runRule(
      r3fNoInternalImports,
      `import x from "@react-three/fiber/dist/internal"; import("@react-three/fiber/src/core"); require("@react-three/fiber/dist/events");`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows documented entry points and shadowed require", () => {
    const result = runRule(
      r3fNoInternalImports,
      `import { Canvas } from "@react-three/fiber"; import { createRoot } from "@react-three/fiber/native"; const require = local; require("@react-three/fiber/dist/x");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
