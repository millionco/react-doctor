import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Fixtures are scanned from an isolated copy OUTSIDE the repository so
// deslop's monorepo-root walk (findMonorepoRoot) cannot escape upward into
// the enclosing workspace and fold its packages into the scan — which would
// otherwise let an ancestor `react` dependency mask "unused" assertions and
// extra sibling packages collide with structural-alias resolution. Mirrors
// the os.tmpdir() isolation react-doctor's own dead-code tests rely on.
const sourceFixturesDirectory = resolve(import.meta.dirname, "../fixtures");
const temporaryFixturesRoot = mkdtempSync(join(tmpdir(), "deslop-fixtures-"));
cpSync(sourceFixturesDirectory, temporaryFixturesRoot, { recursive: true });

// `git init` makes the copy a standalone repo: `git check-ignore` (used by the
// gitignore fixtures) needs a repository, and a `.git` boundary with no
// monorepo markers above the scanned directory keeps findMonorepoRoot returning
// undefined — the same shape as a real single-repo checkout.
spawnSync("git", ["init", "-q"], { cwd: temporaryFixturesRoot });

export const FIXTURES_DIR = realpathSync(temporaryFixturesRoot);

process.on("exit", () => {
  rmSync(temporaryFixturesRoot, { recursive: true, force: true });
});
