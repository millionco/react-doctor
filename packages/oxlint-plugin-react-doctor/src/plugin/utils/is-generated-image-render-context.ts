import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isDefaultImportFromModule,
  isNamespaceImportFromModule,
} from "./find-import-source-for-name.js";
import { findProgramRoot } from "./find-program-root.js";
import { isMemberProperty } from "./is-member-property.js";
import { isNextjsMetadataImageRouteFilename } from "./is-nextjs-metadata-image-route-filename.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

const IMAGE_RESPONSE_MODULES: ReadonlyArray<string> = ["next/og", "@vercel/og"];
const SATORI_MODULE = "satori";

const generatedImageProgramCache = new WeakMap<EsTreeNodeOfType<"Program">, boolean>();

export const isGeneratedImageRenderFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  const filename = normalizeFilename(rawFilename);
  return isNextjsMetadataImageRouteFilename(filename);
};

const isImageResponseCallee = (contextNode: EsTreeNode, callee: EsTreeNode): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return IMAGE_RESPONSE_MODULES.some(
      (moduleSource) =>
        getImportedNameFromModule(contextNode, callee.name, moduleSource) === "ImageResponse",
    );
  }

  if (!isMemberProperty(callee, "ImageResponse")) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  const namespaceIdentifierName = callee.object.name;

  return IMAGE_RESPONSE_MODULES.some((moduleSource) =>
    isNamespaceImportFromModule(contextNode, namespaceIdentifierName, moduleSource),
  );
};

const isSatoriCallee = (contextNode: EsTreeNode, callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (getImportedNameFromModule(contextNode, callee.name, SATORI_MODULE) === "satori") return true;
  return isDefaultImportFromModule(contextNode, callee.name, SATORI_MODULE);
};

const isGeneratedImageRendererCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) {
    return false;
  }

  if (!isNodeOfType(node.callee, "Identifier") && !isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }

  return isImageResponseCallee(node, node.callee) || isSatoriCallee(node, node.callee);
};

const programContainsGeneratedImageRendererCall = (
  programRoot: EsTreeNodeOfType<"Program">,
): boolean => {
  const cached = generatedImageProgramCache.get(programRoot);
  if (cached !== undefined) return cached;

  let containsGeneratedImageRendererCall = false;
  walkAst(programRoot, (descendantNode) => {
    if (containsGeneratedImageRendererCall) return false;
    if (!isGeneratedImageRendererCall(descendantNode)) return;
    containsGeneratedImageRendererCall = true;
    return false;
  });

  generatedImageProgramCache.set(programRoot, containsGeneratedImageRendererCall);
  return containsGeneratedImageRendererCall;
};

export const isGeneratedImageRenderContext = (
  context: RuleContext,
  node?: EsTreeNode,
): boolean => {
  if (isGeneratedImageRenderFilename(context.filename)) return true;
  if (!node) return false;

  const programRoot = findProgramRoot(node);
  if (!programRoot) return false;

  return programContainsGeneratedImageRendererCall(programRoot);
};
