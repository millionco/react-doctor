import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasUnsupportedKeyedDraftRuntime } from "./has-unsupported-keyed-draft-runtime.js";
import { isFunctionLike } from "./is-function-like.js";
import { isImportedJotaiVisibilityAction } from "./is-imported-jotai-visibility-action.js";
import { isImportedMutatingRequest } from "./is-imported-mutating-request.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface RequestActionProgram {
  readonly program: EsTreeNode;
  readonly filename: string;
  readonly scopes: ScopeAnalysis;
}

export interface RequestActionValue {
  readonly node: EsTreeNode;
  readonly facts: RequestActionProgram;
}

export interface RequestActionProof {
  readonly context: RuleContext;
  readonly caller: RequestActionProgram;
  readonly closed: (symbol: SymbolDescriptor | null, facts: RequestActionProgram) => boolean;
  readonly closedFunction: (node: EsTreeNode, facts: RequestActionProgram) => boolean;
  readonly api: (
    node: EsTreeNode,
    source: string,
    name: string,
    facts: RequestActionProgram,
  ) => boolean;
  readonly resolve: (node: EsTreeNode, facts: RequestActionProgram) => RequestActionValue | null;
  readonly property: (node: EsTreeNode, name: string) => EsTreeNode | null;
}

export interface ImportedRequestActionEvidence {
  readonly mutatingAwaits: ReadonlySet<EsTreeNode>;
  readonly stateActions: ReadonlySet<EsTreeNode>;
}

export const getImportedRequestActionEvidence = (
  handler: EsTreeNode,
  context: RuleContext,
): ImportedRequestActionEvidence => {
  const mutatingAwaits = new Set<EsTreeNode>();
  const stateActions = new Set<EsTreeNode>();
  if (!context.filename || !isFunctionLike(handler) || !handler.async) {
    return { mutatingAwaits, stateActions };
  }
  try {
    const sourceText = context.sourceCode?.getText?.();
    if (
      sourceText === undefined ||
      hasJsxRuntimePragma({
        program: context.scopes.rootScope.node,
        filename: context.filename,
        sourceText,
      })
    )
      return { mutatingAwaits, stateActions };
    const awaits: EsTreeNode[] = [];
    const calls: EsTreeNode[] = [];
    walkAst(handler, (node) => {
      if (node !== handler && isFunctionLike(node)) return false;
      if (
        isNodeOfType(node, "AwaitExpression") &&
        isNodeOfType(stripParenExpression(node.argument), "CallExpression")
      )
        awaits.push(node);
      if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "Identifier"))
        calls.push(node);
      return true;
    });
    if (
      calls.length === 0 ||
      !awaits.some((awaited) => {
        if (!isNodeOfType(awaited, "AwaitExpression")) return false;
        const expression = stripParenExpression(awaited.argument);
        return (
          isNodeOfType(expression, "CallExpression") &&
          isNodeOfType(expression.callee, "Identifier") &&
          Boolean(resolveImportedApiReference(expression.callee, context.scopes))
        );
      })
    )
      return { mutatingAwaits, stateActions };
    const programs = new WeakMap<EsTreeNode, RequestActionProgram | null>();
    const factsFor = (
      program: EsTreeNode,
      filename: string,
      scopes?: ScopeAnalysis,
    ): RequestActionProgram | null => {
      if (programs.has(program)) return programs.get(program) ?? null;
      const programScopes = scopes ?? analyzeScopes(program);
      let hasUnsupportedCapability = false;
      walkAst(program, (node) => {
        if (isKeyedDraftTypeReference(node)) return false;
        if (
          (isNodeOfType(node, "MemberExpression") &&
            ["__proto__", "prototype"].includes(getStaticPropertyName(node) ?? "")) ||
          (isNodeOfType(node, "Property") &&
            ["__proto__", "prototype"].includes(getStaticPropertyKeyName(node) ?? ""))
        )
          hasUnsupportedCapability = true;
        if (!isNodeOfType(node, "Identifier")) return;
        if (node.name === "arguments") hasUnsupportedCapability = true;
        if (node.name !== "Object" && node.name !== "Array") return;
        const member = node.parent;
        const invocation = member?.parent;
        const selectedMethod = node.name === "Object" ? "assign" : "isArray";
        if (
          !programScopes.isGlobalReference(node) ||
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== node ||
          member.optional ||
          getStaticPropertyName(member) !== selectedMethod ||
          !isNodeOfType(invocation, "CallExpression") ||
          invocation.callee !== member ||
          invocation.optional ||
          isWithinAssignmentTarget(node)
        )
          hasUnsupportedCapability = true;
      });
      if (hasUnsupportedCapability || hasUnsupportedKeyedDraftRuntime(program)) {
        programs.set(program, null);
        return null;
      }
      const facts = { program, filename, scopes: programScopes };
      programs.set(program, facts);
      return facts;
    };
    const caller = factsFor(context.scopes.rootScope.node, context.filename, context.scopes);
    if (!caller) return { mutatingAwaits, stateActions };
    const closed = (symbol: SymbolDescriptor | null, facts: RequestActionProgram): boolean =>
      Boolean(
        symbol &&
        ["const", "function", "import", "parameter"].includes(symbol.kind) &&
        hasCompleteSymbolReferences(symbol, facts.program, facts.scopes) &&
        getRuntimeSymbolReferences(symbol).every((reference) => {
          if (isKeyedDraftTypeReference(reference.identifier)) return true;
          if (reference.flag !== "read") return false;
          return !isWithinAssignmentTarget(reference.identifier);
        }),
      );
    const closedFunction = (node: EsTreeNode, facts: RequestActionProgram): boolean => {
      if (!isFunctionLike(node) || node.generator) return false;
      const bindings = [
        ...getFunctionBindingSymbols(node, facts.scopes),
        ...(facts.scopes
          .ownScopeFor(node)
          ?.symbols.filter((symbol) => symbol.initializer === node) ?? []),
      ];
      return bindings.length > 0 && bindings.every((symbol) => closed(symbol, facts));
    };
    const closedReference = (node: EsTreeNode, facts: RequestActionProgram): boolean => {
      const expression = stripParenExpression(node);
      if (isNodeOfType(expression, "Identifier")) {
        const symbol = facts.scopes.symbolFor(expression);
        return Boolean(symbol?.kind === "import" && closed(symbol, facts));
      }
      return (
        isNodeOfType(expression, "MemberExpression") &&
        !expression.optional &&
        closedReference(expression.object, facts)
      );
    };
    const api = (
      node: EsTreeNode,
      source: string,
      name: string,
      facts: RequestActionProgram,
    ): boolean => {
      if (source === "jotai" && !isNodeOfType(stripParenExpression(node), "Identifier"))
        return false;
      const imported = resolveImportedApiReference(node, facts.scopes);
      return Boolean(
        imported &&
        imported.source === source &&
        imported.importedName === name &&
        closedReference(node, facts),
      );
    };
    const resolve = (node: EsTreeNode, facts: RequestActionProgram): RequestActionValue | null => {
      const expression = stripParenExpression(node);
      if (
        !isNodeOfType(expression, "Identifier") ||
        !closed(facts.scopes.symbolFor(expression), facts)
      )
        return null;
      const symbol = facts.scopes.symbolFor(expression);
      if (!symbol) return null;
      if (symbol.kind !== "import")
        return symbol.initializer
          ? { node: stripParenExpression(symbol.initializer), facts }
          : null;
      const imported = resolveImportedApiReference(expression, facts.scopes);
      if (!imported?.importedName) return null;
      const exported = resolveCrossFileValueExportWithFilePath(
        facts.filename,
        imported.source,
        imported.importedName,
      );
      if (!exported) return null;
      const foreign = factsFor(exported.programNode, exported.filePath);
      if (!foreign) return null;
      const value = stripParenExpression(exported.exportedNode);
      const exportedBindings = foreign.scopes.rootScope.symbols.filter(
        (binding) => binding.initializer && stripParenExpression(binding.initializer) === value,
      );
      return exportedBindings.length === 1 &&
        exportedBindings.every((binding) => closed(binding, foreign))
        ? { node: value, facts: foreign }
        : null;
    };
    const property = (node: EsTreeNode, name: string): EsTreeNode | null => {
      const object = stripParenExpression(node);
      if (!isNodeOfType(object, "ObjectExpression")) return null;
      let selected: EsTreeNode | null = null;
      for (const member of object.properties) {
        if (
          !isNodeOfType(member, "Property") ||
          member.computed ||
          member.method ||
          member.kind !== "init"
        )
          return null;
        if (getStaticPropertyKeyName(member) !== name) continue;
        if (selected) return null;
        selected = member.value;
      }
      return selected;
    };
    const proof = { context, caller, closed, closedFunction, api, resolve, property };
    for (const awaited of awaits) {
      if (
        isNodeOfType(awaited, "AwaitExpression") &&
        isImportedMutatingRequest(awaited.argument, proof)
      )
        mutatingAwaits.add(awaited);
    }
    if (mutatingAwaits.size === 0) return { mutatingAwaits, stateActions };
    for (const call of calls) {
      if (isImportedJotaiVisibilityAction(call, handler, proof)) stateActions.add(call);
    }
    return stateActions.size > 0
      ? { mutatingAwaits, stateActions }
      : { mutatingAwaits: new Set(), stateActions };
  } catch {
    return { mutatingAwaits: new Set(), stateActions: new Set() };
  }
};
