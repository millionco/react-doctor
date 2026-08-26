import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

describe("no hardcoded credentials", () => {
  it("constants.ts must not contain hardcoded API tokens", () => {
    const constantsPath = fileURLToPath(
      new URL("../src/cli/utils/constants.ts", import.meta.url),
    );
    const constantsContent = readFileSync(constantsPath, "utf8");

    expect(constantsContent).not.toMatch(/xaat-[a-f0-9-]{36}/i);
    expect(constantsContent).not.toMatch(/AXIOM_INGEST_TOKEN\s*=/);
    expect(constantsContent).not.toMatch(/export\s+const\s+\w*TOKEN\s*=\s*["'`]/);
  });

  it("resolve-axiom-telemetry-options.ts must only use env vars for tokens", () => {
    const resolverPath = fileURLToPath(
      new URL("../src/cli/utils/resolve-axiom-telemetry-options.ts", import.meta.url),
    );
    const resolverContent = readFileSync(resolverPath, "utf8");

    expect(resolverContent).not.toMatch(/AXIOM_INGEST_TOKEN/);
    expect(resolverContent).toContain("REACT_DOCTOR_AXIOM_TOKEN");
  });
});
