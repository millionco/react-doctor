import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "./get-string-literal-attribute-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { normalizeFilename } from "./normalize-filename.js";
import { walkAst } from "./walk-ast.js";

interface StaticProjectDomIdInput {
  readonly configuredRootDirectory?: string;
  readonly currentFilePath: string;
  readonly currentProgramNode: EsTreeNodeOfType<"Program">;
  readonly currentScopes: ScopeAnalysis;
}

const HTML_ID_ATTRIBUTE_PATTERN =
  /\bid\s*=\s*(?:"(?<doubleQuoted>[^"]*)"|'(?<singleQuoted>[^']*)'|(?<unquoted>[^\s"'=<>`]+))/gi;
const cachedStaticDomIdsByRootDirectory = new Map<string, ReadonlySet<string> | null>();

const collectStaticJsxIds = (programNode: EsTreeNodeOfType<"Program">, ids: Set<string>): void => {
  walkAst(programNode, (node) => {
    if (!isNodeOfType(node, "JSXOpeningElement")) return;
    const idAttribute = getAuthoritativeJsxAttribute(node.attributes, "id", false);
    const id = idAttribute ? getStringLiteralAttributeValue(idAttribute)?.trim() : null;
    if (id) ids.add(id);
  });
};

const collectStaticHtmlIds = (content: string, ids: Set<string>): void => {
  for (const match of content.matchAll(HTML_ID_ATTRIBUTE_PATTERN)) {
    const id =
      match.groups?.doubleQuoted ?? match.groups?.singleQuoted ?? match.groups?.unquoted ?? "";
    if (id.trim()) ids.add(id.trim());
  }
};

const resolveProjectRootDirectory = (input: StaticProjectDomIdInput): string | null => {
  if (!path.isAbsolute(input.currentFilePath)) return null;
  const rootDirectory = input.configuredRootDirectory
    ? normalizeFilename(input.configuredRootDirectory)
    : null;
  if (!rootDirectory || !isPathInside(input.currentFilePath, rootDirectory)) return null;
  return rootDirectory;
};

export const resetStaticProjectDomIdCache = (): void => {
  cachedStaticDomIdsByRootDirectory.clear();
};

export const getStaticProjectDomIds = (
  input: StaticProjectDomIdInput,
): ReadonlySet<string> | null => {
  const currentIds = new Set<string>();
  collectStaticJsxIds(input.currentProgramNode, currentIds);
  const rootDirectory = resolveProjectRootDirectory(input);
  if (!rootDirectory) return currentIds;

  if (cachedStaticDomIdsByRootDirectory.has(rootDirectory)) {
    const cachedIds = cachedStaticDomIdsByRootDirectory.get(rootDirectory);
    return cachedIds ? new Set([...cachedIds, ...currentIds]) : null;
  }

  const currentFilePath = normalizeFilename(input.currentFilePath);
  const projectIndex = buildSourceProjectIndex(
    rootDirectory,
    currentFilePath,
    input.currentProgramNode,
    input.currentScopes,
  );
  if (!projectIndex) {
    cachedStaticDomIdsByRootDirectory.set(rootDirectory, null);
    return null;
  }

  const projectIds = new Set<string>();
  for (const projectModule of projectIndex.modulesByFilePath.values()) {
    collectStaticJsxIds(projectModule.programNode, projectIds);
  }
  try {
    for (const htmlFilePath of projectIndex.htmlFilePaths) {
      collectStaticHtmlIds(fs.readFileSync(htmlFilePath, "utf8"), projectIds);
    }
  } catch {
    cachedStaticDomIdsByRootDirectory.set(rootDirectory, null);
    return null;
  }
  cachedStaticDomIdsByRootDirectory.set(rootDirectory, projectIds);
  return projectIds;
};
