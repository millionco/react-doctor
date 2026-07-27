import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_FILE_PATH), "..");

export const CANONICAL_REACT_DOCTOR_SKILL_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "skills",
  "react-doctor",
);
export const REACT_DOCTOR_SKILL_ADAPTER_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  ".agents",
  "skills",
  "react-doctor",
);

const hashFileContents = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const readSkillTreeEntries = (rootDirectory) => {
  if (!fs.existsSync(rootDirectory)) return new Map();

  const entries = new Map();
  const visit = (directory) => {
    const directoryEntries = fs.readdirSync(directory, { withFileTypes: true });
    for (const directoryEntry of directoryEntries) {
      const absolutePath = path.join(directory, directoryEntry.name);
      const relativePath = path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
      if (directoryEntry.isDirectory()) {
        entries.set(relativePath, "directory");
        visit(absolutePath);
      } else if (directoryEntry.isFile()) {
        entries.set(relativePath, `file:${hashFileContents(absolutePath)}`);
      } else if (directoryEntry.isSymbolicLink()) {
        entries.set(relativePath, `symlink:${fs.readlinkSync(absolutePath)}`);
      } else {
        entries.set(relativePath, "unsupported");
      }
    }
  };

  visit(rootDirectory);
  return entries;
};

export const findReactDoctorSkillTreeMismatches = (
  canonicalDirectory = CANONICAL_REACT_DOCTOR_SKILL_DIRECTORY,
  adapterDirectory = REACT_DOCTOR_SKILL_ADAPTER_DIRECTORY,
) => {
  const canonicalEntries = readSkillTreeEntries(canonicalDirectory);
  const adapterEntries = readSkillTreeEntries(adapterDirectory);
  const relativePaths = [...new Set([...canonicalEntries.keys(), ...adapterEntries.keys()])].sort();
  const missingCanonicalSkill = canonicalEntries.has("SKILL.md")
    ? []
    : ["missing canonical entry: SKILL.md"];

  return [
    ...missingCanonicalSkill,
    ...relativePaths.flatMap((relativePath) => {
      const canonicalEntry = canonicalEntries.get(relativePath);
      const adapterEntry = adapterEntries.get(relativePath);
      if (canonicalEntry === adapterEntry) return [];
      if (canonicalEntry === undefined) return [`extra adapter entry: ${relativePath}`];
      if (adapterEntry === undefined) return [`missing adapter entry: ${relativePath}`];
      return [`changed adapter entry: ${relativePath}`];
    }),
  ];
};

export const synchronizeReactDoctorSkill = (
  canonicalDirectory = CANONICAL_REACT_DOCTOR_SKILL_DIRECTORY,
  adapterDirectory = REACT_DOCTOR_SKILL_ADAPTER_DIRECTORY,
) => {
  if (!fs.existsSync(path.join(canonicalDirectory, "SKILL.md"))) {
    throw new Error(`Canonical React Doctor skill is missing: ${canonicalDirectory}`);
  }

  fs.rmSync(adapterDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(adapterDirectory), { recursive: true });
  fs.cpSync(canonicalDirectory, adapterDirectory, { recursive: true });
};

const runSkillSynchronization = () => {
  const argumentsList = process.argv.slice(2);
  const shouldOnlyCheck = argumentsList.length === 1 && argumentsList[0] === "--check";
  if (argumentsList.length > 0 && !shouldOnlyCheck) {
    throw new Error("Usage: node scripts/sync-react-doctor-skill.mjs [--check]");
  }

  if (!shouldOnlyCheck) synchronizeReactDoctorSkill();

  const mismatches = findReactDoctorSkillTreeMismatches();
  process.stdout.write(`React Doctor skill adapter mismatch count: ${mismatches.length}\n`);
  if (mismatches.length === 0) return;

  process.stderr.write(
    `${mismatches.join("\n")}\nRun \`nr skills:sync\` from the repository root.\n`,
  );
  process.exitCode = 1;
};

if (path.resolve(process.argv[1] ?? "") === SCRIPT_FILE_PATH) runSkillSynchronization();
