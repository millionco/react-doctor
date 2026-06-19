import * as fs from "node:fs";

// The GitHub Action's release surface, per AGENTS.md ("GitHub Action
// versioning"): a change to any of these files is an action release and must be
// tagged. Keep this list in sync with that section.
const ACTION_RELEASE_FILES = [
  "action.yml",
  "scripts/ensure-json-report.mjs",
  "scripts/render-github-action-comment.mjs",
];

const COMMENT_MARKER = "<!-- react-doctor:action-version -->";
const STRICT_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

const BUMP_REASON = {
  major: "a **major** bump (breaking change to the action's inputs/outputs or runtime contract)",
  minor: "a **minor** bump (`feat` — a new action capability)",
  patch: "a **patch** bump (fix / refactor / chore / docs)",
};

const [commentOutputPath] = process.argv.slice(2);

const changedFiles = (process.env.ACTION_CHANGED_FILES ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const commitSubject = (process.env.ACTION_COMMIT_SUBJECT ?? "").trim();
const allTags = (process.env.ACTION_ALL_TAGS ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const appendOutput = (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${value ?? ""}\n`);
};

const compareVersions = (left, right) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

const formatTag = (version) => `v${version.major}.${version.minor}.${version.patch}`;

// Highest strict `vMAJOR.MINOR.PATCH` tag, ignoring the floating-major aliases
// (`v1`, `v2`) and any pre-rebuild oddities — those never match the pattern.
const pickLatestTag = () => {
  let latest = null;
  for (const tag of allTags) {
    const match = STRICT_TAG_PATTERN.exec(tag);
    if (!match) continue;
    const version = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
    if (!latest || compareVersions(version, latest) > 0) latest = version;
  }
  return latest ?? { major: 0, minor: 0, patch: 0 };
};

// Conventional-commit → action bump level (AGENTS.md): a breaking change to the
// inputs/outputs or runtime contract is a major; a `feat` is a minor; everything
// else (fix / refactor / chore / revert / docs) is a patch.
const classifyBumpLevel = (subject) => {
  if (/^[a-z]+(\([^)]*\))?!:/i.test(subject) || /BREAKING[ -]CHANGE/.test(subject)) {
    return "major";
  }
  if (/^feat(\([^)]*\))?:/i.test(subject)) return "minor";
  return "patch";
};

const computeNextVersion = (current, level) => {
  if (level === "major") return { major: current.major + 1, minor: 0, patch: 0 };
  if (level === "minor") return { major: current.major, minor: current.minor + 1, patch: 0 };
  return { major: current.major, minor: current.minor, patch: current.patch + 1 };
};

const buildCommentBody = ({ changed, currentTag, nextTag, majorTag, level, tagExists }) => {
  const changedList = changed.map((file) => `- \`${file}\``).join("\n");
  const reason = BUMP_REASON[level];
  const lines = [
    COMMENT_MARKER,
    "",
    "### 📦 GitHub Action release recommended",
    "",
    "This PR changes the React Doctor GitHub Action's release surface:",
    "",
    changedList,
    "",
    "The composite action is versioned independently from the npm packages, so it",
    "needs its own git tag once this merges. Based on the PR title, this looks like",
    `${reason}: \`${currentTag}\` → **\`${nextTag}\`**.`,
    "",
  ];
  if (tagExists) {
    lines.push(
      `> ⚠️ Tag \`${nextTag}\` already exists. Confirm it points at this change before re-tagging, or pick the next free version.`,
      "",
    );
  }
  lines.push(
    "After merging, cut the tag from the merge commit on `main` (tags are GPG-signed",
    "annotated tags, so run this locally where your signing key is configured):",
    "",
    "```bash",
    "git checkout main && git pull --ff-only",
    "merge_commit=$(git rev-parse HEAD)",
    `git tag -a ${nextTag} "$merge_commit" -m "react-doctor action ${nextTag}"`,
    `git tag -fa ${majorTag} "$merge_commit" -m "react-doctor action ${majorTag} (floating major -> ${nextTag})"`,
    `git push origin ${nextTag}`,
    `git push --force origin ${majorTag}   # moves only the floating major pointer`,
    "```",
    "",
    "<sub>This bump can also be performed automatically on merge — set the repo",
    "variable `AUTO_BUMP_ACTION_TAG=true`. Recommendation by the Action Version Bump workflow.</sub>",
  );
  return `${lines.join("\n")}\n`;
};

const latest = pickLatestTag();
const changedActionFiles = changedFiles.filter((file) => ACTION_RELEASE_FILES.includes(file));
const changed = changedActionFiles.length > 0;
const level = classifyBumpLevel(commitSubject);
const next = computeNextVersion(latest, level);
const currentTag = formatTag(latest);
const nextTag = formatTag(next);
const majorTag = `v${next.major}`;
const tagExists = allTags.includes(nextTag);

appendOutput("changed", String(changed));
appendOutput("level", level);
appendOutput("current", currentTag);
appendOutput("next", nextTag);
appendOutput("major", majorTag);
appendOutput("tag-exists", String(tagExists));

if (changed && commentOutputPath) {
  fs.writeFileSync(
    commentOutputPath,
    buildCommentBody({
      changed: changedActionFiles,
      currentTag,
      nextTag,
      majorTag,
      level,
      tagExists,
    }),
  );
}

const summary = changed
  ? `Action release surface changed (${changedActionFiles.join(", ")}). Recommend ${level} bump: ${currentTag} -> ${nextTag}.`
  : "No action release surface changes detected.";
process.stdout.write(`${summary}\n`);
