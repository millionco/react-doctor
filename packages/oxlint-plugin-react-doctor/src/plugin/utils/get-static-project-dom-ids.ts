import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  getJsxPropKnownStaticStringValues,
  getKnownStaticStringExpressionValues,
} from "./get-jsx-prop-static-string-values.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { normalizeFilename } from "./normalize-filename.js";
import { resolveJsxElementType } from "./resolve-jsx-element-type.js";
import { resolveStaticJsxAttribute } from "./resolve-static-jsx-attribute.js";
import { walkAst } from "./walk-ast.js";

interface StaticProjectDomIdInput {
  readonly configuredRootDirectory?: string;
  readonly currentFilePath: string;
  readonly currentProgramNode: EsTreeNodeOfType<"Program">;
  readonly currentScopes: ScopeAnalysis;
}

const HTML_ATTRIBUTE_PATTERN =
  /(?<attributeName>[^\s"'<>/=]+)(?:\s*=\s*(?:"(?<doubleQuoted>[^"]*)"|'(?<singleQuoted>[^']*)'|(?<unquoted>[^\s"'=<>`]+)))?/g;
const HTML_TOKEN_PATTERN =
  /<!--[\s\S]*?-->|(?<skippedContentOpeningTag><(?<skippedContentTag>script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext|template)\b(?:"[^"]*"|'[^']*'|[^'"<>])*?>)[\s\S]*?(?:<\/\k<skippedContentTag>\s*>|$)|(?<openingTag><[A-Za-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>)/gi;
const cachedStaticDomIdsByRootDirectory = new Map<string, ReadonlySet<string> | null>();

const collectResolvedStaticJsxId = (
  idResolution: ReturnType<typeof resolveStaticJsxAttribute>,
  scopes: ScopeAnalysis,
  ids: Set<string>,
): void => {
  if (!idResolution.isPresent) return;
  const candidateIds = idResolution.attribute
    ? getJsxPropKnownStaticStringValues(idResolution.attribute, scopes)
    : idResolution.expression
      ? getKnownStaticStringExpressionValues(idResolution.expression, scopes)
      : null;
  for (const candidateId of candidateIds ?? []) {
    const id = candidateId?.trim();
    if (id) ids.add(id);
  }
};

const collectKnownStaticObjectIds = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  scopes: ScopeAnalysis,
  ids: Set<string>,
): void => {
  for (const property of objectExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      if (isNodeOfType(property.argument, "ObjectExpression")) {
        collectKnownStaticObjectIds(property.argument, scopes, ids);
      }
      continue;
    }
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property, { allowComputedString: true })?.toLowerCase() !== "id") {
      continue;
    }
    for (const candidateId of getKnownStaticStringExpressionValues(property.value, scopes) ?? []) {
      const id = candidateId.trim();
      if (id) ids.add(id);
    }
  }
};

const isInsideJsxTemplateContent = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">) => {
  let ancestor = openingElement.parent;
  if (isNodeOfType(ancestor, "JSXElement") && ancestor.openingElement === openingElement) {
    ancestor = ancestor.parent;
  }
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      resolveJsxElementType(ancestor.openingElement) === "template"
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const collectStaticJsxIds = (
  programNode: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  ids: Set<string>,
): void => {
  walkAst(programNode, (node) => {
    if (!isNodeOfType(node, "JSXOpeningElement")) return;
    if (isInsideJsxTemplateContent(node)) return;
    const idResolution = resolveStaticJsxAttribute(node.attributes, "id", false);
    if (idResolution.isUnknown) {
      for (const attribute of node.attributes) {
        collectResolvedStaticJsxId(
          resolveStaticJsxAttribute([attribute], "id", false),
          scopes,
          ids,
        );
        if (
          isNodeOfType(attribute, "JSXSpreadAttribute") &&
          isNodeOfType(attribute.argument, "ObjectExpression")
        ) {
          collectKnownStaticObjectIds(attribute.argument, scopes, ids);
        }
      }
      return;
    }
    collectResolvedStaticJsxId(idResolution, scopes, ids);
  });
};

const collectStaticHtmlIds = (content: string, ids: Set<string>): void => {
  for (const tokenMatch of content.matchAll(HTML_TOKEN_PATTERN)) {
    const openingTag = tokenMatch.groups?.skippedContentOpeningTag ?? tokenMatch.groups?.openingTag;
    if (!openingTag) continue;
    for (const idAttributeMatch of openingTag.matchAll(HTML_ATTRIBUTE_PATTERN)) {
      if (idAttributeMatch.groups?.attributeName?.toLowerCase() !== "id") continue;
      const id =
        idAttributeMatch.groups?.doubleQuoted ??
        idAttributeMatch.groups?.singleQuoted ??
        idAttributeMatch.groups?.unquoted ??
        "";
      if (id.trim()) ids.add(id.trim());
    }
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
  collectStaticJsxIds(input.currentProgramNode, input.currentScopes, currentIds);
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
    collectStaticJsxIds(projectModule.programNode, projectModule.scopes, projectIds);
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
  return new Set([...projectIds, ...currentIds]);
};
