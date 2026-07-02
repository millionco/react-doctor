import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Yoinks react-bench's RD-health TARGET files — the exact files the
// benchmark selected for having ≥6 severe React Doctor diagnostics — out of
// the RDE repo cache into a flat corpus directory for FUZZ_CORPUS_DIR.
// These are the highest-yield fuzz seeds available: every one is known to
// fire multiple rules.
//
// Each `tasks/fix-react-rdh-*` directory carries everything needed: the
// environment Dockerfile pins `git clone <repo>` + `git checkout <sha>`,
// and instruction.md names the target file in backticks.
//
//   REACT_BENCH=~/Developer/react-bench \
//   RDE_REPO_CACHE=~/.cache/rde/repos \
//   CLONE_MISSING=1 \
//   bun scripts/build-bench-corpus.ts
//
// CLONE_MISSING=1 shallow-clones (blob-filtered, pinned SHA) any bench repo
// absent from the RDE cache into tmp/bench-clones/ (kept for reuse).
// Output: packages/fuzz/tmp/bench-corpus/ (gitignored).

const reactBenchRoot = process.env.REACT_BENCH ?? path.join(os.homedir(), "Developer/react-bench");
const repoCachePath = process.env.RDE_REPO_CACHE ?? path.join(os.homedir(), ".cache/rde/repos");
const outputDirectory = path.join(import.meta.dirname, "..", "tmp", "bench-corpus");

const CLONE_PATTERN = /git clone (?:--[^\s]+ )*https:\/\/github\.com\/([\w.-]+\/[\w.-]+)/;
const CHECKOUT_PATTERN = /git checkout ([0-9a-f]{40})/;
const TARGET_FILE_PATTERN = /`([\w./@-]+\.(?:tsx|jsx|ts|js))`/;
const shouldCloneMissing = process.env.CLONE_MISSING === "1";
const clonesDirectory = path.join(import.meta.dirname, "..", "tmp", "bench-clones");

const cachedRepoNames = fs.readdirSync(repoCachePath);
const findCachedRepo = (repo: string): string | null => {
  const slug = repo.replace("/", "-").toLowerCase();
  const match = cachedRepoNames.find((name) => name.toLowerCase().startsWith(`${slug}-`));
  return match ? path.join(repoCachePath, match) : null;
};

const cloneRepoAtSha = (repo: string, sha: string): string | null => {
  const cloneRoot = path.join(clonesDirectory, repo.replace("/", "__"));
  if (fs.existsSync(cloneRoot)) return cloneRoot;
  try {
    fs.mkdirSync(clonesDirectory, { recursive: true });
    execFileSync(
      "git",
      ["clone", "--filter=blob:none", "--quiet", `https://github.com/${repo}`, cloneRoot],
      { stdio: "pipe", timeout: 180_000 },
    );
    execFileSync("git", ["-C", cloneRoot, "checkout", "--quiet", sha], {
      stdio: "pipe",
      timeout: 60_000,
    });
    return cloneRoot;
  } catch {
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    return null;
  }
};

const tasksDirectory = path.join(reactBenchRoot, "tasks");
const taskNames = fs
  .readdirSync(tasksDirectory)
  .filter((name) => name.startsWith("fix-react-rdh-"));

fs.mkdirSync(outputDirectory, { recursive: true });
let copied = 0;
let missingRepos = 0;
let missingFiles = 0;
for (const taskName of taskNames) {
  const taskRoot = path.join(tasksDirectory, taskName);
  let dockerfile = "";
  let instruction = "";
  try {
    dockerfile = fs.readFileSync(path.join(taskRoot, "environment", "Dockerfile"), "utf8");
    instruction = fs.readFileSync(path.join(taskRoot, "instruction.md"), "utf8");
  } catch {
    continue;
  }
  const repoMatch = dockerfile.match(CLONE_PATTERN);
  const shaMatch = dockerfile.match(CHECKOUT_PATTERN);
  const fileMatch = instruction.match(TARGET_FILE_PATTERN);
  if (!repoMatch || !fileMatch) continue;
  let repoRoot = findCachedRepo(repoMatch[1]);
  if (!repoRoot && shouldCloneMissing && shaMatch) {
    repoRoot = cloneRepoAtSha(repoMatch[1], shaMatch[1]);
  }
  if (!repoRoot) {
    missingRepos += 1;
    continue;
  }
  const relativeFile = fileMatch[1];
  const sourcePath = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(sourcePath)) {
    missingFiles += 1;
    continue;
  }
  const extension = path.extname(relativeFile);
  const targetExtension = extension === ".jsx" ? ".jsx" : ".tsx";
  fs.copyFileSync(sourcePath, path.join(outputDirectory, `${taskName}${targetExtension}`));
  copied += 1;
}
console.log(
  `copied ${copied}/${taskNames.length} rdh target files to ${outputDirectory} (missing repos: ${missingRepos}, missing files: ${missingFiles})`,
);
