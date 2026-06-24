import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { analyze, defineConfig } from "deslop-js";
import { afterAll, describe, expect, it } from "vite-plus/test";

// `check-dead-code.ts` passes BOTH `semantic: { enabled: false }` and
// `reportCodeQuality: false` to deslop because react-doctor consumes only
// deslop's GRAPH-based findings (unused files, exports, dependencies, cycles).
// The semantic TS-Program pass and the code-quality detectors (duplicate
// blocks, complexity, feature flags, TS smells, …) derive only findings we
// discard — and are the bulk of the runtime (~8.5x slower with them on at
// Sentry scale). This test LOCKS the assumption that they're independent of the
// consumed findings: if a future deslop release ever makes a CONSUMED finding
// depend on either pass, disabling it would silently drop diagnostics, and this
// parity check fails first — flagging that check-dead-code must change.

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

describe("deslop discarded-passes parity", () => {
  it("produces identical graph-based findings with semantic + code-quality on vs off", async () => {
    const projectDirectory = buildFixture();
    const tsConfigPath = path.join(projectDirectory, "tsconfig.json");

    // Full deslop (every detector) vs react-doctor's actual config — BOTH the
    // semantic TS-Program pass AND the expensive code-quality detectors
    // (duplicate blocks, complexity, feature flags, TS smells, private-type
    // leaks, re-export cycles) disabled, since react-doctor discards their
    // output and they are the bulk of the runtime.
    const full = await analyze(defineConfig({ rootDir: projectDirectory, tsConfigPath }));
    const deadCodeOnly = await analyze(
      defineConfig({
        rootDir: projectDirectory,
        tsConfigPath,
        semantic: { enabled: false },
        reportCodeQuality: false,
      }),
    );

    // The fixture must actually exercise the consumed findings, or "identical"
    // would be a vacuous pass on two empty results.
    expect(full.unusedFiles.length).toBeGreaterThan(0);
    expect(full.unusedExports.length).toBeGreaterThan(0);

    expect(consumedFindingSignature(deadCodeOnly)).toBe(consumedFindingSignature(full));
  });
});
