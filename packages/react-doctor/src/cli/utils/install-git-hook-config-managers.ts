import * as path from "node:path";
import * as fs from "node:fs";
import {
  ensureTrailingNewline,
  getPackageJsonPath,
  isRecord,
  NON_BLOCKING_REACT_DOCTOR_COMMAND,
  REACT_DOCTOR_COMMAND,
  readPackageJson,
  writeJsonFile,
} from "./git-hook-shared.js";
import {
  GitHookKind,
  type InstallGitHookOptions,
  type InstallGitHookResult,
} from "./git-hook-types.js";
import { removeLegacyManagedRunner } from "./install-git-hook-file.js";

const appendStringCommand = (existingCommand: unknown): string => {
  const existingCommandText =
    typeof existingCommand === "string"
      ? existingCommand
      : Array.isArray(existingCommand)
        ? existingCommand.filter((entry) => typeof entry === "string").join("\n")
        : "";
  return existingCommandText.includes(REACT_DOCTOR_COMMAND)
    ? existingCommandText
    : [existingCommandText, NON_BLOCKING_REACT_DOCTOR_COMMAND].filter(Boolean).join("\n");
};

const appendArrayCommand = (existingCommands: unknown): string[] => {
  const commands = Array.isArray(existingCommands)
    ? existingCommands.filter((entry): entry is string => typeof entry === "string")
    : typeof existingCommands === "string"
      ? [existingCommands]
      : [];
  return commands.some((command) => command.includes(REACT_DOCTOR_COMMAND))
    ? commands
    : [...commands, NON_BLOCKING_REACT_DOCTOR_COMMAND];
};

interface PackageJsonHookStrategy {
  readonly kind: GitHookKind;
  /**
   * Dotted path of keys into `package.json` to reach the leaf where
   * the pre-commit command lives. `["simple-git-hooks", "pre-commit"]`
   * walks `package.json["simple-git-hooks"]["pre-commit"]`. Intermediate
   * objects are created when missing; non-record intermediates are
   * replaced with a fresh empty object.
   */
  readonly path: ReadonlyArray<string>;
  /**
   * Shape of the leaf value the manager expects. `"string"` joins
   * commands with newlines (the shape simple-git-hooks / ghooks /
   * yorkie / pretty-quick / git-hooks-js use); `"array"` keeps each
   * command as a separate string element (the shape pre-commit-npm
   * uses).
   */
  readonly leafShape: "string" | "array";
}

const installPackageJsonHook = (
  options: InstallGitHookOptions,
  strategy: PackageJsonHookStrategy,
): InstallGitHookResult => {
  const packageJsonPath = getPackageJsonPath(options.projectRoot);
  const didHookExist = fs.existsSync(packageJsonPath);
  const packageJson = readPackageJson(options.projectRoot);
  const nextPackageJson = isRecord(packageJson) ? { ...packageJson } : {};

  // Walk down to the parent of the leaf, cloning each intermediate
  // record so the original package.json shape isn't mutated in place
  // (writeJsonFile re-serializes the new tree).
  const parentKeys = strategy.path.slice(0, -1);
  const leafKey = strategy.path[strategy.path.length - 1];
  let parent: Record<string, unknown> = nextPackageJson;
  for (const key of parentKeys) {
    const existing = parent[key];
    const cloned = isRecord(existing) ? { ...existing } : {};
    parent[key] = cloned;
    parent = cloned;
  }
  parent[leafKey] =
    strategy.leafShape === "array"
      ? appendArrayCommand(parent[leafKey])
      : appendStringCommand(parent[leafKey]);

  writeJsonFile(packageJsonPath, nextPackageJson);
  removeLegacyManagedRunner(options.projectRoot);
  return {
    hookPath: packageJsonPath,
    kind: strategy.kind,
    status: didHookExist ? "updated" : "created",
  };
};

export const installSimpleGitHooks = (options: InstallGitHookOptions): InstallGitHookResult =>
  installPackageJsonHook(options, {
    kind: GitHookKind.SimpleGitHooks,
    path: ["simple-git-hooks", "pre-commit"],
    leafShape: "string",
  });

export const installGhooks = (options: InstallGitHookOptions): InstallGitHookResult =>
  installPackageJsonHook(options, {
    kind: GitHookKind.Ghooks,
    path: ["config", "ghooks", "pre-commit"],
    leafShape: "string",
  });

export const installPreCommitNpm = (options: InstallGitHookOptions): InstallGitHookResult =>
  installPackageJsonHook(options, {
    kind: GitHookKind.PreCommitNpm,
    path: ["pre-commit"],
    leafShape: "array",
  });

export const installPrettyQuick = (options: InstallGitHookOptions): InstallGitHookResult =>
  installPackageJsonHook(options, {
    kind: GitHookKind.PrettyQuick,
    path: ["gitHooks", "pre-commit"],
    leafShape: "string",
  });

export const installYorkie = (options: InstallGitHookOptions): InstallGitHookResult =>
  installPackageJsonHook(options, {
    kind: GitHookKind.Yorkie,
    path: ["gitHooks", "pre-commit"],
    leafShape: "string",
  });

export const installGitHooksJs = (options: InstallGitHookOptions): InstallGitHookResult =>
  installPackageJsonHook(options, {
    kind: GitHookKind.GitHooksJs,
    path: ["git-hooks", "pre-commit"],
    leafShape: "string",
  });

const appendIndentedBlockToTopLevelSection = (
  content: string,
  sectionName: string,
  block: readonly string[],
): string => {
  const normalizedContent = ensureTrailingNewline(content);
  const sectionPattern = new RegExp(`^${sectionName}:\\s*$`, "m");
  const match = sectionPattern.exec(normalizedContent);
  if (match === null) {
    return ensureTrailingNewline(
      [normalizedContent.trimEnd(), "", `${sectionName}:`, ...block, ""]
        .filter((line, index) => index > 0 || line.length > 0)
        .join("\n"),
    );
  }

  const sectionStartIndex = match.index;
  const nextSectionPattern = /^[A-Za-z0-9_-]+:\s*$/gm;
  nextSectionPattern.lastIndex = sectionStartIndex + match[0].length;
  let nextSectionMatch = nextSectionPattern.exec(normalizedContent);
  while (nextSectionMatch !== null && nextSectionMatch.index === sectionStartIndex) {
    nextSectionMatch = nextSectionPattern.exec(normalizedContent);
  }

  const insertIndex = nextSectionMatch?.index ?? normalizedContent.length;
  const prefix = normalizedContent.slice(0, insertIndex).trimEnd();
  const suffix = normalizedContent.slice(insertIndex);
  return ensureTrailingNewline([prefix, ...block, suffix.trimStart()].join("\n"));
};

interface TopLevelSectionRange {
  readonly headerEndIndex: number;
  readonly contentEndIndex: number;
}

const findTopLevelSectionRange = (
  content: string,
  sectionName: string,
): TopLevelSectionRange | null => {
  const sectionPattern = new RegExp(`^${sectionName}:\\s*$`, "m");
  const match = sectionPattern.exec(content);
  if (match === null) return null;

  const headerLineEndIndex = content.indexOf("\n", match.index);
  const headerEndIndex =
    headerLineEndIndex === -1 ? match.index + match[0].length : headerLineEndIndex + 1;
  const nextSectionPattern = /^[A-Za-z0-9_-]+:\s*$/gm;
  nextSectionPattern.lastIndex = headerEndIndex;
  const nextSectionMatch = nextSectionPattern.exec(content);
  return {
    headerEndIndex,
    contentEndIndex: nextSectionMatch?.index ?? content.length,
  };
};

const appendLefthookCommand = (content: string): string => {
  const normalizedContent = ensureTrailingNewline(content);
  const sectionRange = findTopLevelSectionRange(normalizedContent, "pre-commit");
  const reactDoctorCommandBlock = [
    "    react-doctor:",
    `      run: ${NON_BLOCKING_REACT_DOCTOR_COMMAND}`,
    "",
  ];

  if (sectionRange === null) {
    return ensureTrailingNewline(
      [normalizedContent.trimEnd(), "", "pre-commit:", "  commands:", ...reactDoctorCommandBlock]
        .filter((line, index) => index > 0 || line.length > 0)
        .join("\n"),
    );
  }

  const sectionContent = normalizedContent.slice(
    sectionRange.headerEndIndex,
    sectionRange.contentEndIndex,
  );
  const commandsMatch = /^  commands:\s*$/m.exec(sectionContent);

  const insertIndex =
    commandsMatch === null
      ? sectionRange.headerEndIndex
      : sectionRange.headerEndIndex +
        sectionContent.indexOf(commandsMatch[0]) +
        commandsMatch[0].length +
        1;
  const insertBlock =
    commandsMatch === null
      ? ["  commands:", ...reactDoctorCommandBlock].join("\n")
      : reactDoctorCommandBlock.join("\n");

  return ensureTrailingNewline(
    `${normalizedContent.slice(0, insertIndex)}${insertBlock}${normalizedContent.slice(insertIndex)}`,
  );
};

export const installLefthook = (options: InstallGitHookOptions): InstallGitHookResult => {
  const didHookExist = fs.existsSync(options.hookPath);
  const existingContent = didHookExist ? fs.readFileSync(options.hookPath, "utf8") : "";
  if (!existingContent.includes("react-doctor")) {
    const nextContent = appendLefthookCommand(existingContent);
    fs.mkdirSync(path.dirname(options.hookPath), { recursive: true });
    fs.writeFileSync(options.hookPath, nextContent);
  }
  removeLegacyManagedRunner(options.projectRoot);

  return {
    hookPath: options.hookPath,
    kind: GitHookKind.Lefthook,
    status: didHookExist ? "updated" : "created",
  };
};

export const installPreCommit = (options: InstallGitHookOptions): InstallGitHookResult => {
  const didHookExist = fs.existsSync(options.hookPath);
  const existingContent = didHookExist ? fs.readFileSync(options.hookPath, "utf8") : "";
  if (!existingContent.includes("id: react-doctor")) {
    const hasReposKey = /^repos:\s*$/m.test(existingContent);
    const localHookBlock = [
      "  - repo: local",
      "    hooks:",
      "      - id: react-doctor",
      "        name: react-doctor",
      `        entry: sh -c '${NON_BLOCKING_REACT_DOCTOR_COMMAND}'`,
      "        language: system",
      "        pass_filenames: false",
      "",
    ].join("\n");
    const nextContent = hasReposKey
      ? `${ensureTrailingNewline(existingContent)}${localHookBlock}`
      : `repos:\n${localHookBlock}`;
    fs.mkdirSync(path.dirname(options.hookPath), { recursive: true });
    fs.writeFileSync(options.hookPath, nextContent);
  }
  removeLegacyManagedRunner(options.projectRoot);

  return {
    hookPath: options.hookPath,
    kind: GitHookKind.PreCommit,
    status: didHookExist ? "updated" : "created",
  };
};

export const installOvercommit = (options: InstallGitHookOptions): InstallGitHookResult => {
  const didHookExist = fs.existsSync(options.hookPath);
  const existingContent = didHookExist ? fs.readFileSync(options.hookPath, "utf8") : "";
  if (!existingContent.includes("ReactDoctor")) {
    const nextContent = appendIndentedBlockToTopLevelSection(existingContent, "PreCommit", [
      "  ReactDoctor:",
      "    enabled: true",
      `    command: ['sh', '-c', '${NON_BLOCKING_REACT_DOCTOR_COMMAND}']`,
      "",
    ]);
    fs.mkdirSync(path.dirname(options.hookPath), { recursive: true });
    fs.writeFileSync(options.hookPath, nextContent);
  }
  removeLegacyManagedRunner(options.projectRoot);
  return {
    hookPath: options.hookPath,
    kind: GitHookKind.Overcommit,
    status: didHookExist ? "updated" : "created",
  };
};
