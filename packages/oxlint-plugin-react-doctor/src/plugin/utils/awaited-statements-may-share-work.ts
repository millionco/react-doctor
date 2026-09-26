import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { resolveImportedExportName } from "./find-exported-function-body.js";
import { getAwaitedStatementInfo } from "./find-sequential-independent-await.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isAwaitedCallExpression } from "./is-awaited-call-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isGuardedCacheReader } from "./is-guarded-cache-reader.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSynchronousArrayJoin } from "./is-synchronous-array-join.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface AwaitedWork {
  binding: EsTreeNode;
  member: string | null;
  inputs: ReadonlyArray<EsTreeNode | null>;
  crossFile?: boolean;
}

const importedScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();
const PRIMITIVE_RETURN_TYPES = new Set(["TSStringKeyword", "TSNumberKeyword", "TSBooleanKeyword"]);
const PRIMITIVE_CONSTRUCTORS = new Set(["String", "Number", "Boolean"]);

const collectAwaitedWork = (
  statement: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): AwaitedWork[] => {
  const work: AwaitedWork[] = [];
  let remainingCalls = FUNCTION_RESOLUTION_MAX_DEPTH;

  const collect = (
    expression: EsTreeNode,
    bindings: ReadonlyMap<EsTreeNode, EsTreeNode | null>,
    functionNode: EsTreeNode | null,
    currentScopes: ScopeAnalysis,
    currentFilename: string | undefined,
    isCrossFile: boolean,
  ): void => {
    const resolveInput = (input: EsTreeNode): EsTreeNode | null => {
      const symbol = resolveConstIdentifierAlias(stripParenExpression(input), currentScopes);
      if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
      if (bindings.has(symbol.bindingIdentifier)) {
        return bindings.get(symbol.bindingIdentifier) ?? null;
      }
      if (functionNode && findEnclosingFunction(symbol.bindingIdentifier) === functionNode) {
        return null;
      }
      return symbol.bindingIdentifier;
    };

    walkAst(expression, (node) => {
      if (
        isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")
      ) {
        return false;
      }
      if (
        isCrossFile &&
        isNodeOfType(node, "AwaitExpression") &&
        !isNodeOfType(stripParenExpression(node.argument), "CallExpression")
      ) {
        work.push({ binding: node, member: null, inputs: [], crossFile: true });
      }
      if (!isNodeOfType(node, "CallExpression")) return;
      const callee = stripParenExpression(node.callee);
      if (node.optional || (isNodeOfType(callee, "MemberExpression") && callee.optional)) {
        if (isCrossFile) work.push({ binding: node, member: null, inputs: [], crossFile: true });
        return false;
      }
      const inputs = node.arguments.map(resolveInput);
      const receiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : callee;
      const receiverSymbol = resolveConstIdentifierAlias(receiver, currentScopes);
      let target =
        isNodeOfType(callee, "Identifier") &&
        (receiverSymbol?.kind === "function" || isFunctionLike(receiverSymbol?.initializer))
          ? resolveExactLocalFunction(callee, currentScopes)
          : null;
      let targetScopes = currentScopes;
      let targetFilename = currentFilename;
      let targetIsCrossFile = isCrossFile;
      if (receiverSymbol?.kind === "import") {
        const member = isNodeOfType(callee, "MemberExpression")
          ? getStaticPropertyName(callee)
          : null;
        const specifier = receiverSymbol.declarationNode;
        const declaration = getImportDeclarationForSymbol(receiverSymbol);
        const exportedName = isNodeOfType(specifier, "ImportNamespaceSpecifier")
          ? member
          : isNodeOfType(callee, "Identifier")
            ? resolveImportedExportName(specifier)
            : null;
        if (
          currentFilename &&
          remainingCalls > 0 &&
          exportedName &&
          declaration &&
          declaration.importKind !== "type" &&
          (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type")
        ) {
          remainingCalls--;
          const resolved = resolveCrossFileFunctionExportWithFilePath(
            currentFilename,
            declaration.source.value,
            exportedName,
          );
          if (resolved) {
            target = resolved.functionNode;
            targetScopes =
              importedScopes.get(resolved.programNode) ?? analyzeScopes(resolved.programNode);
            importedScopes.set(resolved.programNode, targetScopes);
            targetFilename = resolved.filePath;
            targetIsCrossFile = true;
          }
        }
        if (!target && !isCrossFile && (isNodeOfType(callee, "Identifier") || member !== null)) {
          work.push({ binding: receiverSymbol.bindingIdentifier, member, inputs });
        }
      } else if (
        !isCrossFile &&
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "get" &&
        receiverSymbol?.kind === "const" &&
        receiverSymbol.initializer
      ) {
        const initializer = stripParenExpression(receiverSymbol.initializer);
        if (
          isNodeOfType(initializer, "NewExpression") &&
          isNodeOfType(initializer.callee, "Identifier") &&
          (initializer.callee.name === "Map" || initializer.callee.name === "WeakMap") &&
          currentScopes.isGlobalReference(initializer.callee)
        ) {
          const cache = resolveInput(receiver);
          if (cache) work.push({ binding: cache, member: "get", inputs: [inputs[0] ?? null] });
        }
      }
      if (targetIsCrossFile && target) {
        const identifier = getDirectFunctionBindingIdentifier(target);
        const symbol = identifier ? targetScopes.symbolFor(identifier) : null;
        if (
          symbol &&
          ((symbol.kind !== "const" && symbol.kind !== "function") ||
            symbol.references.some((reference) => reference.flag !== "read"))
        ) {
          work.push({ binding: node, member: null, inputs: [], crossFile: true });
          return false;
        }
      }
      if (targetIsCrossFile && target && isGuardedCacheReader(target, targetScopes)) {
        work.push({ binding: target, member: null, inputs, crossFile: true });
        return false;
      }
      if (!isFunctionLike(target) || remainingCalls <= 0) {
        if (
          isCrossFile &&
          (remainingCalls <= 0 ||
            receiverSymbol?.kind === "import" ||
            isAwaitedCallExpression(node) ||
            (isNodeOfType(node.parent, "ReturnStatement") &&
              !isSynchronousArrayJoin(node, currentScopes) &&
              !(
                isNodeOfType(callee, "Identifier") &&
                PRIMITIVE_CONSTRUCTORS.has(callee.name) &&
                currentScopes.isGlobalReference(callee)
              )) ||
            (isNodeOfType(callee, "Identifier") &&
              callee.name === "fetch" &&
              currentScopes.isGlobalReference(callee)))
        ) {
          work.push({ binding: node, member: null, inputs: [], crossFile: true });
        }
        return;
      }
      if (
        isCrossFile &&
        !target.async &&
        !isAwaitedCallExpression(node) &&
        (!isNodeOfType(node.parent, "ReturnStatement") ||
          (isNodeOfType(target.returnType, "TSTypeAnnotation") &&
            PRIMITIVE_RETURN_TYPES.has(target.returnType.typeAnnotation.type)))
      )
        return;
      remainingCalls--;
      const localBindings = new Map(bindings);
      for (const [parameterIndex, parameter] of target.params.entries()) {
        const symbol = targetScopes.symbolFor(parameter);
        if (symbol) localBindings.set(symbol.bindingIdentifier, inputs[parameterIndex] ?? null);
      }
      collect(target.body, localBindings, target, targetScopes, targetFilename, targetIsCrossFile);
    });
  };

  for (const expression of getAwaitedStatementInfo(statement)?.awaitedExpressions ?? []) {
    collect(expression, new Map(), null, scopes, filename, false);
  }
  return work;
};

export const awaitedStatementsMayShareWork = (
  previousStatement: EsTreeNode,
  nextStatement: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean => {
  const previousWork = collectAwaitedWork(previousStatement, scopes, filename);
  if (previousWork.length === 0) return false;
  const nextWork = collectAwaitedWork(nextStatement, scopes, filename);
  const matchesPrevious = (next: AwaitedWork): boolean =>
    previousWork.some(
      (previous) =>
        previous.binding === next.binding &&
        previous.member === next.member &&
        previous.inputs.length > 0 &&
        previous.inputs.length === next.inputs.length &&
        previous.inputs.every((input, index) => input !== null && input === next.inputs[index]),
    );
  return (
    nextWork.some(matchesPrevious) &&
    (!nextWork.some((work) => work.crossFile) || nextWork.every(matchesPrevious))
  );
};
