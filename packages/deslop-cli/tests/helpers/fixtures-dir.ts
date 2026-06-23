import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// deslop-cli reuses deslop-js's fixtures, so it needs the same isolation: copy
// them OUTSIDE the repository and `git init` the copy so the CLI's
// findMonorepoRoot walk stops at the temp boundary instead of escaping into the
// enclosing react-doctor workspace and folding its packages into the scan.
// Mirrors packages/core/tests/deslop/helpers/fixtures-dir.ts (kept local rather
// than shared because the two packages publish independently). The deslop
// engine — and its fixtures — now live in @react-doctor/core.
const sourceFixturesDirectory = resolve(import.meta.dirname, "../../../core/tests/deslop/fixtures");
const temporaryFixturesRoot = mkdtempSync(join(tmpdir(), "deslop-cli-fixtures-"));
cpSync(sourceFixturesDirectory, temporaryFixturesRoot, { recursive: true });

spawnSync("git", ["init", "-q"], { cwd: temporaryFixturesRoot });

export const FIXTURES_DIR = realpathSync(temporaryFixturesRoot);

process.on("exit", () => {
  rmSync(temporaryFixturesRoot, { recursive: true, force: true });
});
