import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  hasImportFromModules,
  isDefaultImportFromModule,
  isNamespaceImportFromModule,
} from "./find-import-source-for-name.js";
import { findProgramRoot } from "./find-program-root.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { flattenJsxName } from "./flatten-jsx-name.js";
import { isMemberProperty } from "./is-member-property.js";
import { isNextjsMetadataImageRouteFilename } from "./is-nextjs-metadata-image-route-filename.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const IMAGE_RESPONSE_MODULES: ReadonlyArray<string> = ["next/og", "@vercel/og"];
const SATORI_MODULE = "satori";
const GENERATED_IMAGE_MODULES: ReadonlyArray<string> = [...IMAGE_RESPONSE_MODULES, SATORI_MODULE];

const generatedImageJsxCache = new WeakMap<EsTreeNodeOfType<"Program">, WeakSet<EsTreeNode>>();

type GeneratedImageRendererCall =
  | EsTreeNodeOfType<"CallExpression">
  | EsTreeNodeOfType<"NewExpression">;

const isGeneratedImageRenderFilename = (rawFilename: string | undefined): boolean => {
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

const isGeneratedImageRendererCall = (node: EsTreeNode): node is GeneratedImageRendererCall => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) {
    return false;
  }

  if (!isNodeOfType(node.callee, "Identifier") && !isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }

  return isImageResponseCallee(node, node.callee) || isSatoriCallee(node, node.callee);
};

const isComponentIdentifierName = (name: string): boolean => {
  const firstCharacter = name[0];
  return Boolean(firstCharacter && firstCharacter === firstCharacter.toUpperCase());
};

const isFunctionLike = (
  node: EsTreeNode | null | undefined,
): node is
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression"> =>
  Boolean(
    node &&
    (isNodeOfType(node, "FunctionDeclaration") ||
      isNodeOfType(node, "FunctionExpression") ||
      isNodeOfType(node, "ArrowFunctionExpression")),
  );

const markFunctionReturnJsx = (
  functionNode: EsTreeNode,
  programRoot: EsTreeNodeOfType<"Program">,
  generatedImageJsxNodes: WeakSet<EsTreeNode>,
  visitedComponentNames: Set<string>,
): void => {
  if (!isFunctionLike(functionNode)) return;

  if (isNodeOfType(functionNode, "ArrowFunctionExpression")) {
    const body = stripParenExpression(functionNode.body);
    if (!isNodeOfType(body, "BlockStatement")) {
      markGeneratedImageExpression(
        body,
        programRoot,
        generatedImageJsxNodes,
        visitedComponentNames,
      );
      return;
    }
  }

  const body = functionNode.body;
  if (!isNodeOfType(body, "BlockStatement")) return;

  walkAst(body, (descendantNode) => {
    if (descendantNode !== body && isFunctionLike(descendantNode)) return false;
    if (!isNodeOfType(descendantNode, "ReturnStatement")) return;
    if (!descendantNode.argument) return;
    markGeneratedImageExpression(
      stripParenExpression(descendantNode.argument),
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
  });
};

const hasNormalJsxUsage = (
  programRoot: EsTreeNodeOfType<"Program">,
  componentName: string,
  generatedImageJsxNodes: WeakSet<EsTreeNode>,
): boolean => {
  let hasNormalUsage = false;
  walkAst(programRoot, (descendantNode) => {
    if (hasNormalUsage) return false;
    if (!isNodeOfType(descendantNode, "JSXOpeningElement")) return;
    if (generatedImageJsxNodes.has(descendantNode)) return;
    if (flattenJsxName(descendantNode.name) !== componentName) return;
    hasNormalUsage = true;
    return false;
  });
  return hasNormalUsage;
};

const markComponentRenderJsx = (
  programRoot: EsTreeNodeOfType<"Program">,
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  generatedImageJsxNodes: WeakSet<EsTreeNode>,
  visitedComponentNames: Set<string>,
): void => {
  const tagName = flattenJsxName(openingElement.name);
  if (!tagName || tagName.includes(".") || !isComponentIdentifierName(tagName)) return;
  if (visitedComponentNames.has(tagName)) return;
  if (hasNormalJsxUsage(programRoot, tagName, generatedImageJsxNodes)) return;

  const binding = findVariableInitializer(openingElement, tagName);
  if (!binding?.initializer) return;

  visitedComponentNames.add(tagName);
  markGeneratedImageExpression(
    stripParenExpression(binding.initializer),
    programRoot,
    generatedImageJsxNodes,
    visitedComponentNames,
  );
};

const isInsideGeneratedImageRendererArgument = (node: EsTreeNode): boolean => {
  let cursor = node.parent;
  while (cursor) {
    if (isGeneratedImageRendererCall(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const hasNormalFunctionCallUsage = (
  programRoot: EsTreeNodeOfType<"Program">,
  functionName: string,
): boolean => {
  let hasNormalUsage = false;
  walkAst(programRoot, (descendantNode) => {
    if (hasNormalUsage) return false;
    if (!isNodeOfType(descendantNode, "CallExpression")) return;
    if (!isNodeOfType(descendantNode.callee, "Identifier")) return;
    if (descendantNode.callee.name !== functionName) return;
    if (isInsideGeneratedImageRendererArgument(descendantNode)) return;
    hasNormalUsage = true;
    return false;
  });
  return hasNormalUsage;
};

const markJsxSubtree = (
  node: EsTreeNode,
  programRoot: EsTreeNodeOfType<"Program">,
  generatedImageJsxNodes: WeakSet<EsTreeNode>,
  visitedComponentNames: Set<string>,
): void => {
  walkAst(node, (descendantNode) => {
    if (!isNodeOfType(descendantNode, "JSXOpeningElement")) return;
    generatedImageJsxNodes.add(descendantNode);
    markComponentRenderJsx(
      programRoot,
      descendantNode,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
  });
};

const markGeneratedImageExpression = (
  expression: EsTreeNode,
  programRoot: EsTreeNodeOfType<"Program">,
  generatedImageJsxNodes: WeakSet<EsTreeNode>,
  visitedComponentNames: Set<string>,
): void => {
  const unwrappedExpression = stripParenExpression(expression);

  if (
    isNodeOfType(unwrappedExpression, "JSXElement") ||
    isNodeOfType(unwrappedExpression, "JSXFragment")
  ) {
    markJsxSubtree(unwrappedExpression, programRoot, generatedImageJsxNodes, visitedComponentNames);
    return;
  }

  if (isFunctionLike(unwrappedExpression)) {
    markFunctionReturnJsx(
      unwrappedExpression,
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
    return;
  }

  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    markGeneratedImageExpression(
      unwrappedExpression.consequent,
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
    markGeneratedImageExpression(
      unwrappedExpression.alternate,
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
    return;
  }

  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    markGeneratedImageExpression(
      unwrappedExpression.left,
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
    markGeneratedImageExpression(
      unwrappedExpression.right,
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
    return;
  }

  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callee = unwrappedExpression.callee;
    if (isFunctionLike(callee)) {
      markFunctionReturnJsx(callee, programRoot, generatedImageJsxNodes, visitedComponentNames);
      return;
    }
    if (!isNodeOfType(callee, "Identifier")) return;
    if (visitedComponentNames.has(callee.name)) return;
    if (hasNormalJsxUsage(programRoot, callee.name, generatedImageJsxNodes)) return;
    if (hasNormalFunctionCallUsage(programRoot, callee.name)) return;
    const binding = findVariableInitializer(callee, callee.name);
    if (!binding?.initializer || !isFunctionLike(stripParenExpression(binding.initializer))) return;
    visitedComponentNames.add(callee.name);
    markFunctionReturnJsx(
      stripParenExpression(binding.initializer),
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
    return;
  }

  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    if (visitedComponentNames.has(unwrappedExpression.name)) return;
    visitedComponentNames.add(unwrappedExpression.name);
    const binding = findVariableInitializer(unwrappedExpression, unwrappedExpression.name);
    if (!binding?.initializer) return;
    markGeneratedImageExpression(
      stripParenExpression(binding.initializer),
      programRoot,
      generatedImageJsxNodes,
      visitedComponentNames,
    );
  }
};

const collectGeneratedImageJsxNodes = (
  programRoot: EsTreeNodeOfType<"Program">,
): WeakSet<EsTreeNode> => {
  const cached = generatedImageJsxCache.get(programRoot);
  if (cached) return cached;

  const generatedImageJsxNodes = new WeakSet<EsTreeNode>();
  // Renderer detection below is import-lookup based, so a module that never
  // imports an image-response library can't produce a match — skip its walk.
  if (hasImportFromModules(programRoot, GENERATED_IMAGE_MODULES)) {
    walkAst(programRoot, (descendantNode) => {
      if (!isGeneratedImageRendererCall(descendantNode)) return;
      for (const argument of descendantNode.arguments) {
        markGeneratedImageExpression(argument, programRoot, generatedImageJsxNodes, new Set());
      }
    });
  }

  generatedImageJsxCache.set(programRoot, generatedImageJsxNodes);
  return generatedImageJsxNodes;
};

export const isGeneratedImageRenderContext = (context: RuleContext, node?: EsTreeNode): boolean => {
  if (isGeneratedImageRenderFilename(context.filename)) return true;
  if (!node) return false;

  const programRoot = findProgramRoot(node);
  if (!programRoot) return false;

  const generatedImageJsxNodes = collectGeneratedImageJsxNodes(programRoot);
  if (generatedImageJsxNodes.has(node)) return true;
  if (isNodeOfType(node, "JSXElement")) {
    return generatedImageJsxNodes.has(node.openingElement);
  }
  return false;
};
