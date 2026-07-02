import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Materializes a real-world fuzz corpus on ANY machine — no RDE cache
// required. `corpus-repos.json` pins a deterministic 48-repo sample of the
// react-doctor-evals corpus (org/name/ref). For each entry, the fast path
// symlinks the repo out of the RDE cache when present; otherwise it
// blob-filter-clones at the pinned ref. Re-runs are incremental.
//
//   bun scripts/sync-fuzz-corpus.ts            # all pinned repos
//   SYNC_LIMIT=10 bun scripts/sync-fuzz-corpus.ts
//   RDE_REPO_CACHE=<dir> bun scripts/sync-fuzz-corpus.ts
//
// Output: packages/fuzz/tmp/corpus-repos/ (gitignored) — point
// FUZZ_CORPUS_DIR at it.

interface PinnedCorpusRepo {
  org: string;
  name: string;
  ref: string;
}

const repoCachePath = process.env.RDE_REPO_CACHE ?? path.join(os.homedir(), ".cache/rde/repos");
const outputDirectory = path.join(import.meta.dirname, "..", "tmp", "corpus-repos");
const syncLimit = Number(process.env.SYNC_LIMIT ?? Infinity);

const pinnedRepos: PinnedCorpusRepo[] = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "corpus-repos.json"), "utf8"),
);

let cachedRepoNames: string[] = [];
try {
  cachedRepoNames = fs.readdirSync(repoCachePath);
} catch {
  cachedRepoNames = [];
}

const gitHeadSha = (repoRoot: string): string | null => {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      stdio: "pipe",
      timeout: 30_000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

fs.mkdirSync(outputDirectory, { recursive: true });
let linked = 0;
let cloned = 0;
let repinned = 0;
let reused = 0;
let failed = 0;
for (const repo of pinnedRepos.slice(0, syncLimit)) {
  const slug = `${repo.org}__${repo.name}`;
  const targetPath = path.join(outputDirectory, slug);
  // An existing entry only counts when its tree actually sits at the
  // pinned ref — manifest updates and stale cache symlinks must not be
  // silently reused.
  if (fs.existsSync(targetPath)) {
    if (gitHeadSha(targetPath) === repo.ref) {
      reused += 1;
      continue;
    }
    const isSymbolicLink = fs.lstatSync(targetPath).isSymbolicLink();
    if (!isSymbolicLink) {
      try {
        execFileSync("git", ["-C", targetPath, "fetch", "--quiet", "origin", repo.ref], {
          stdio: "pipe",
          timeout: 300_000,
        });
        execFileSync("git", ["-C", targetPath, "checkout", "--quiet", repo.ref], {
          stdio: "pipe",
          timeout: 120_000,
        });
        repinned += 1;
        continue;
      } catch {
        // fall through to a fresh clone
      }
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  // Cache directory names embed the checkout SHA, so only an exact
  // `<org>-<name>-<ref>` match may be symlinked.
  const cachedName = cachedRepoNames.find(
    (name) => name.toLowerCase() === `${repo.org}-${repo.name}-${repo.ref}`.toLowerCase(),
  );
  if (cachedName) {
    fs.symlinkSync(path.join(repoCachePath, cachedName), targetPath);
    linked += 1;
    continue;
  }
  try {
    execFileSync(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--quiet",
        `https://github.com/${repo.org}/${repo.name}`,
        targetPath,
      ],
      { stdio: "pipe", timeout: 300_000 },
    );
    execFileSync("git", ["-C", targetPath, "checkout", "--quiet", repo.ref], {
      stdio: "pipe",
      timeout: 120_000,
    });
    cloned += 1;
  } catch {
    fs.rmSync(targetPath, { recursive: true, force: true });
    failed += 1;
  }
}
console.log(
  `corpus at ${outputDirectory}: ${reused} reused, ${repinned} re-pinned, ${linked} linked from cache, ${cloned} cloned, ${failed} failed`,
);
