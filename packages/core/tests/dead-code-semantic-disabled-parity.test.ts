import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { analyze, defineConfig } from "deslop-js";
import { afterAll, describe, expect, it } from "vite-plus/test";

// `check-dead-code.ts` passes `semantic: { enabled: false }` to deslop because
// react-doctor consumes only deslop's GRAPH-based findings (unused files,
// exports, dependencies, cycles); the semantic TS-Program pass derives only
// findings we discard, at ~37-45% of the phase's wall-clock. This test LOCKS
// that assumption: if a future deslop release ever makes a CONSUMED finding
// depend on the semantic pass, disabling it would silently drop diagnostics —
// and this parity check fails first, flagging that check-dead-code must change.

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-deslop-semantic-parity-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

// A fixture that produces every consumed finding kind at once — an orphan file
// (unused-file), reachable-but-unused value AND type exports (unused-export),
// an unimported dependency (unused-dependency), and an a↔b cycle
// (circular-dependency). The type-only export is the case where the semantic
// pass could plausibly matter; the graph detector must still catch it with
// semantic disabled.
const buildFixture = (): string => {
  const projectDirectory = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, "fixture-")));
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "deslop-semantic-parity",
      type: "module",
      dependencies: { react: "^19.0.0", "left-pad": "^1.3.0" },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" },
    }),
    "src/index.ts":
      "import './cycle-a';\n" +
      "export const usedValue = 1;\n" +
      "export const unusedValue = 2;\n" +
      "export type UnusedType = { id: string };\n",
    "src/orphan.ts": "export const orphan = 1;\n",
    "src/cycle-a.ts": "import './cycle-b';\nexport const a = 1;\n",
    "src/cycle-b.ts": "import './cycle-a';\nexport const b = 1;\n",
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return projectDirectory;
};

// Only the fields react-doctor actually reads from a deslop result, normalized
// to a stable, order-independent signature.
const consumedFindingSignature = (result: {
  unusedFiles: ReadonlyArray<{ path: string }>;
  unusedExports: ReadonlyArray<{ path: string; name: string; isTypeOnly: boolean }>;
  unusedDependencies: ReadonlyArray<{ name: string; isDevDependency: boolean }>;
  circularDependencies: ReadonlyArray<{ files: ReadonlyArray<string> }>;
}): string =>
  JSON.stringify({
    unusedFiles: result.unusedFiles.map((entry) => entry.path).sort(),
    unusedExports: result.unusedExports
      .map((entry) => `${entry.path}::${entry.name}${entry.isTypeOnly ? ":type" : ""}`)
      .sort(),
    unusedDependencies: result.unusedDependencies
      .map((entry) => `${entry.name}:${entry.isDevDependency ? "dev" : "prod"}`)
      .sort(),
    circularDependencies: result.circularDependencies
      .map((cycle) => [...cycle.files].sort().join(" -> "))
      .sort(),
  });

describe("deslop semantic-disabled parity", () => {
  it("produces identical graph-based findings with the semantic pass on and off", async () => {
    const projectDirectory = buildFixture();
    const tsConfigPath = path.join(projectDirectory, "tsconfig.json");

    const withSemantic = await analyze(defineConfig({ rootDir: projectDirectory, tsConfigPath }));
    const withoutSemantic = await analyze(
      defineConfig({ rootDir: projectDirectory, tsConfigPath, semantic: { enabled: false } }),
    );

    // The fixture must actually exercise the consumed findings, or "identical"
    // would be a vacuous pass on two empty results.
    expect(withSemantic.unusedFiles.length).toBeGreaterThan(0);
    expect(withSemantic.unusedExports.length).toBeGreaterThan(0);

    expect(consumedFindingSignature(withoutSemantic)).toBe(consumedFindingSignature(withSemantic));
  });
});
