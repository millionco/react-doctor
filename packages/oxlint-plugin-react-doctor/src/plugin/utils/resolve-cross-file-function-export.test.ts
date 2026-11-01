import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { captureCrossFileProbes } from "./cross-file-probe-recorder.js";
import { resetFilesystemCaches } from "./reset-filesystem-caches.js";
import { resetTsconfigAliasCaches } from "./resolve-tsconfig-alias.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";

let temporaryDirectory = "";
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "captured-export-resolver-"));
  fs.writeFileSync(
    path.join(temporaryDirectory, "first.ts"),
    "export const selected = () => true;\n",
  );
  fs.writeFileSync(
    path.join(temporaryDirectory, "second.ts"),
    "export const selected = () => false;\n",
  );
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

for (const initialTarget of ["first.ts", "missing.ts"]) {
  it(`refreshes a captured ${initialTarget} export after alias-only resets`, () => {
    const importer = path.join(temporaryDirectory, "consumer.ts");
    for (const target of [initialTarget, "second.ts", initialTarget]) {
      fs.writeFileSync(
        path.join(temporaryDirectory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@media": ["./" + target] } } }),
      );
      resetTsconfigAliasCaches();
      const cold = captureCrossFileProbes(() =>
        resolveCrossFileValueExportWithFilePath(importer, "@media", "selected"),
      );
      const warm = captureCrossFileProbes(() =>
        resolveCrossFileValueExportWithFilePath(importer, "@media", "selected"),
      );
      expect(cold.value?.filePath ?? null).toBe(
        target === "missing.ts" ? null : path.join(temporaryDirectory, target),
      );
      expect(warm.value).toBe(cold.value);
      expect(warm.trace).toEqual(cold.trace);
      expect(cold.trace.contentPaths.has(path.join(temporaryDirectory, "tsconfig.json"))).toBe(
        true,
      );
    }
  });
}
