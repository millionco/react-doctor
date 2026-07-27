import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_FILE_PATH), "..");
const AGENT_GUIDANCE_PATHS = ["AGENTS.md"];
const AGENT_REFERENCE_DIRECTORY = ".agents/references";
const TRACKED_SKILL_PATHSPECS = [":(glob)skills/**/SKILL.md", ":(glob).agents/skills/**/SKILL.md"];
const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MARKDOWN_LINK_PATTERN = /!?\[[^\]\r\n]*\]\((<[^>\r\n]+>|[^)\r\n]+)\)/g;
const MARKDOWN_REFERENCE_LINK_PATTERN = /^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(<[^>\r\n]+>|\S+)/gm;
const INLINE_CODE_PATTERN = /`([^`\r\n]+)`/g;
const NR_COMMAND_PATTERN =
  /\bnr(?:[ \t]+--filter[ \t]+([A-Za-z0-9@/._-]+))?[ \t]+([A-Za-z0-9:_-]+)/g;
const REPOSITORY_PATH_PATTERN =
  /^(?:AGENTS\.md|action\.yml|package\.json|pnpm-lock\.yaml|(?:\.agents|\.github|contracts|packages|scripts|skills)\/)/;
const SKILL_DIRECTORY_RESOURCE_PATTERN =
  /(?:\$(?:\{SKILL_DIR\}|SKILL_DIR)|<skill-directory>)\/((?:assets|scripts)\/[A-Za-z0-9_./-]+)/gi;
const REPOSITORY_RESOURCE_PATTERN =
  /((?:\.agents\/skills|skills|packages)\/[A-Za-z0-9_./-]*\/(?:assets|scripts)\/[A-Za-z0-9_./-]+)/g;
const INVALID_PLAIN_SCALAR_PATTERN = /^(?:|null|~|true|false|[-+]?(?:\d+\.?\d*|\.\d+))$/i;

const toPosixPath = (filePath) => filePath.split(path.sep).join("/");

const lineNumberAt = (sourceText, characterIndex) =>
  sourceText.slice(0, characterIndex).split(/\r?\n/).length;

const isInsideDirectory = (directory, candidatePath) => {
  const relativePath = path.relative(directory, candidatePath);
  return (
    relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..")
  );
};

const createIssue = (manifestPath, line, message) => ({
  manifestPath,
  line,
  message,
});

const isNonEmptyStringScalar = (value) => {
  const trimmedValue = value.trim();
  const firstCharacter = trimmedValue[0];
  if (firstCharacter === '"' || firstCharacter === "'") {
    return trimmedValue.endsWith(firstCharacter) && trimmedValue.slice(1, -1).trim().length > 0;
  }
  return (
    !INVALID_PLAIN_SCALAR_PATTERN.test(trimmedValue) &&
    !["[", "{", "&", "*", "!"].includes(firstCharacter)
  );
};

const readBlockScalarValue = (frontmatter, fieldName) => {
  const fieldPattern = new RegExp(`^${fieldName}[ \\t]*:[ \\t]*([>|][+-]?)$`, "m");
  const match = frontmatter.match(fieldPattern);
  if (!match || match.index === undefined) return null;

  const followingLines = frontmatter
    .slice(match.index + match[0].length)
    .split(/\r?\n/)
    .slice(1);
  const valueLines = [];
  for (const line of followingLines) {
    if (line !== "" && !/^[ \t]/.test(line)) break;
    valueLines.push(line.trim());
  }
  return valueLines.filter(Boolean).join(" ");
};

const validateFrontmatter = (manifestPath, sourceText) => {
  const match = sourceText.match(FRONTMATTER_PATTERN);
  if (!match) return [createIssue(manifestPath, 1, "missing YAML frontmatter")];

  const frontmatter = match[1] ?? "";
  return ["name", "description"].flatMap((fieldName) => {
    const fieldPattern = new RegExp(`^${fieldName}[ \\t]*:[ \\t]*(.*)$`, "gm");
    const matches = [...frontmatter.matchAll(fieldPattern)];
    if (matches.length === 0) {
      return [createIssue(manifestPath, 1, `missing frontmatter field "${fieldName}"`)];
    }
    if (matches.length > 1) {
      return [createIssue(manifestPath, 1, `duplicate frontmatter field "${fieldName}"`)];
    }

    const inlineValue = (matches[0][1] ?? "").trim();
    const isBlockScalar = /^[>|][+-]?$/.test(inlineValue);
    const scalarValue = isBlockScalar ? readBlockScalarValue(frontmatter, fieldName) : inlineValue;
    if (
      scalarValue !== null &&
      (isBlockScalar ? scalarValue.trim().length > 0 : isNonEmptyStringScalar(scalarValue))
    ) {
      return [];
    }
    return [
      createIssue(manifestPath, 1, `frontmatter field "${fieldName}" must be a non-empty scalar`),
    ];
  });
};

const parseMarkdownDestination = (rawDestination) => {
  const trimmedDestination = rawDestination.trim();
  if (trimmedDestination.startsWith("<")) {
    const closingBracketIndex = trimmedDestination.indexOf(">");
    return closingBracketIndex === -1
      ? null
      : trimmedDestination.slice(1, closingBracketIndex).trim();
  }
  const destinationMatch = trimmedDestination.match(/^(?:\\.|[^\s])+/);
  return destinationMatch === null ? null : destinationMatch[0];
};

const normalizeRelativeDestination = (destination) => {
  if (
    destination === "" ||
    /^[#/~$]/.test(destination) ||
    destination.includes("<") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)
  ) {
    return null;
  }

  const [pathWithoutFragment = ""] = destination.split(/[?#]/, 1);
  if (pathWithoutFragment === "") return null;
  try {
    return decodeURIComponent(pathWithoutFragment.replaceAll("\\ ", " "));
  } catch {
    return null;
  }
};

const validateMarkdownLinks = (repositoryRoot, manifestPath, sourceText) => {
  const manifestDirectory = path.dirname(path.resolve(repositoryRoot, manifestPath));
  const linkMatches = [
    ...sourceText.matchAll(MARKDOWN_LINK_PATTERN),
    ...sourceText.matchAll(MARKDOWN_REFERENCE_LINK_PATTERN),
  ];
  return linkMatches.flatMap((match) => {
    const destination = parseMarkdownDestination(match[1] ?? "");
    const relativeDestination =
      destination === null ? null : normalizeRelativeDestination(destination);
    if (relativeDestination === null) return [];

    const resolvedPath = path.resolve(manifestDirectory, relativeDestination);
    if (!isInsideDirectory(repositoryRoot, resolvedPath) || fs.existsSync(resolvedPath)) return [];
    return [
      createIssue(
        manifestPath,
        lineNumberAt(sourceText, match.index ?? 0),
        `broken relative Markdown link: ${relativeDestination}`,
      ),
    ];
  });
};

const validateLocalResources = (repositoryRoot, manifestPath, sourceText) => {
  const manifestDirectory = path.dirname(path.resolve(repositoryRoot, manifestPath));
  const resourceReferences = [
    ...[...sourceText.matchAll(SKILL_DIRECTORY_RESOURCE_PATTERN)].map((match) => ({
      relativePath: match[1] ?? "",
      resolvedPath: path.resolve(manifestDirectory, match[1] ?? ""),
      index: match.index ?? 0,
    })),
    ...[...sourceText.matchAll(REPOSITORY_RESOURCE_PATTERN)].map((match) => ({
      relativePath: match[1] ?? "",
      resolvedPath: path.resolve(repositoryRoot, match[1] ?? ""),
      index: match.index ?? 0,
    })),
  ];
  const seenPaths = new Set();

  return resourceReferences.flatMap((reference) => {
    if (
      reference.relativePath === "" ||
      seenPaths.has(reference.resolvedPath) ||
      !isInsideDirectory(repositoryRoot, reference.resolvedPath)
    ) {
      return [];
    }
    seenPaths.add(reference.resolvedPath);
    if (fs.existsSync(reference.resolvedPath)) return [];
    return [
      createIssue(
        manifestPath,
        lineNumberAt(sourceText, reference.index),
        `missing local resource: ${reference.relativePath}`,
      ),
    ];
  });
};

const findAgentGuidancePaths = (repositoryRoot) => {
  const referenceDirectory = path.join(repositoryRoot, AGENT_REFERENCE_DIRECTORY);
  const referencePaths = fs.existsSync(referenceDirectory)
    ? fs
        .readdirSync(referenceDirectory, { withFileTypes: true })
        .filter((directoryEntry) => directoryEntry.isFile() && directoryEntry.name.endsWith(".md"))
        .map((directoryEntry) => path.join(AGENT_REFERENCE_DIRECTORY, directoryEntry.name))
    : [];
  return [...AGENT_GUIDANCE_PATHS, ...referencePaths].sort();
};

const readPackageScripts = (packageJsonPath) => {
  if (!fs.existsSync(packageJsonPath)) return null;
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson.scripts && typeof packageJson.scripts === "object"
    ? new Set(Object.keys(packageJson.scripts))
    : new Set();
};

const findWorkspacePackageJsonPath = (repositoryRoot, workspaceName) => {
  const packagesDirectory = path.join(repositoryRoot, "packages");
  if (!fs.existsSync(packagesDirectory)) return null;

  for (const directoryEntry of fs.readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory()) continue;
    const packageJsonPath = path.join(packagesDirectory, directoryEntry.name, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (packageJson.name === workspaceName) return packageJsonPath;
  }
  return null;
};

const validateNrCommands = (repositoryRoot, documentPath, sourceText) =>
  [...sourceText.matchAll(NR_COMMAND_PATTERN)].flatMap((match) => {
    const workspaceName = match[1];
    const scriptName = match[2] ?? "";
    if (scriptName === "SCRIPT_NAME" || scriptName === "script_name") return [];

    const packageJsonPath =
      workspaceName === undefined
        ? path.join(repositoryRoot, "package.json")
        : findWorkspacePackageJsonPath(repositoryRoot, workspaceName);
    if (packageJsonPath === null) {
      return [
        createIssue(
          documentPath,
          lineNumberAt(sourceText, match.index ?? 0),
          `documented nr workspace does not exist: ${workspaceName}`,
        ),
      ];
    }

    const scripts = readPackageScripts(packageJsonPath);
    if (scripts?.has(scriptName)) return [];
    const command =
      workspaceName === undefined
        ? `nr ${scriptName}`
        : `nr --filter ${workspaceName} ${scriptName}`;
    return [
      createIssue(
        documentPath,
        lineNumberAt(sourceText, match.index ?? 0),
        `documented script does not exist: ${command}`,
      ),
    ];
  });

const validateCanonicalRepositoryPaths = (repositoryRoot, documentPath, sourceText) =>
  [...sourceText.matchAll(INLINE_CODE_PATTERN)].flatMap((match) => {
    const repositoryPath = match[1] ?? "";
    if (
      !REPOSITORY_PATH_PATTERN.test(repositoryPath) ||
      /[\s*{}<>]/.test(repositoryPath) ||
      repositoryPath.includes("#")
    ) {
      return [];
    }

    const pathWithoutTrailingSlash = repositoryPath.replace(/\/$/, "");
    if (fs.existsSync(path.resolve(repositoryRoot, pathWithoutTrailingSlash))) return [];
    return [
      createIssue(
        documentPath,
        lineNumberAt(sourceText, match.index ?? 0),
        `canonical repository path does not exist: ${repositoryPath}`,
      ),
    ];
  });

export const validateAgentGuidanceDocuments = ({
  repositoryRoot = REPOSITORY_ROOT,
  guidancePaths = findAgentGuidancePaths(repositoryRoot),
} = {}) =>
  guidancePaths
    .flatMap((guidancePath) => {
      const documentPath = toPosixPath(guidancePath);
      const absoluteDocumentPath = path.resolve(repositoryRoot, guidancePath);
      if (!fs.existsSync(absoluteDocumentPath)) {
        return [createIssue(documentPath, 1, "agent guidance document is missing")];
      }

      const sourceText = fs.readFileSync(absoluteDocumentPath, "utf8");
      return [
        ...validateMarkdownLinks(repositoryRoot, documentPath, sourceText),
        ...validateNrCommands(repositoryRoot, documentPath, sourceText),
        ...validateCanonicalRepositoryPaths(repositoryRoot, documentPath, sourceText),
      ];
    })
    .sort(
      (leftIssue, rightIssue) =>
        leftIssue.manifestPath.localeCompare(rightIssue.manifestPath) ||
        leftIssue.line - rightIssue.line ||
        leftIssue.message.localeCompare(rightIssue.message),
    );

export const findTrackedSkillManifestPaths = (repositoryRoot = REPOSITORY_ROOT) =>
  childProcess
    .execFileSync("git", ["ls-files", "-z", "--", ...TRACKED_SKILL_PATHSPECS], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
    .split("\0")
    .filter(Boolean)
    .sort();

export const validateSkillDocuments = ({
  repositoryRoot = REPOSITORY_ROOT,
  skillManifestPaths = findTrackedSkillManifestPaths(repositoryRoot),
} = {}) =>
  skillManifestPaths
    .flatMap((skillManifestPath) => {
      const manifestPath = toPosixPath(skillManifestPath);
      const absoluteManifestPath = path.resolve(repositoryRoot, skillManifestPath);
      if (!fs.existsSync(absoluteManifestPath)) {
        return [createIssue(manifestPath, 1, "tracked skill manifest is missing")];
      }

      const sourceText = fs.readFileSync(absoluteManifestPath, "utf8");
      return [
        ...validateFrontmatter(manifestPath, sourceText),
        ...validateMarkdownLinks(repositoryRoot, manifestPath, sourceText),
        ...validateLocalResources(repositoryRoot, manifestPath, sourceText),
      ];
    })
    .sort(
      (leftIssue, rightIssue) =>
        leftIssue.manifestPath.localeCompare(rightIssue.manifestPath) ||
        leftIssue.line - rightIssue.line ||
        leftIssue.message.localeCompare(rightIssue.message),
    );

export const formatSkillValidationIssues = (issues) =>
  issues.map((issue) => `${issue.manifestPath}:${issue.line} - ${issue.message}`).join("\n");

const runSkillCheck = () => {
  const skillManifestPaths = findTrackedSkillManifestPaths();
  if (skillManifestPaths.length === 0) {
    throw new Error("No tracked skills/**/SKILL.md or .agents/skills/**/SKILL.md files found.");
  }

  const skillIssues = validateSkillDocuments({ skillManifestPaths });
  const guidancePaths = findAgentGuidancePaths(REPOSITORY_ROOT);
  const guidanceIssues = validateAgentGuidanceDocuments({ guidancePaths });
  process.stdout.write(
    `Skill document validation: ${skillManifestPaths.length} manifests, ${skillIssues.length} issues.\n`,
  );
  process.stdout.write(
    `Agent guidance validation: ${guidancePaths.length} documents, ${guidanceIssues.length} issues.\n`,
  );
  const issues = [...skillIssues, ...guidanceIssues];
  if (issues.length === 0) return;
  process.stderr.write(`${formatSkillValidationIssues(issues)}\n`);
  process.exitCode = 1;
};

if (path.resolve(process.argv[1] ?? "") === SCRIPT_FILE_PATH) runSkillCheck();
