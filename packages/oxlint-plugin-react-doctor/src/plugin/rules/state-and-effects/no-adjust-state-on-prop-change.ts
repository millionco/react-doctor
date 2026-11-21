import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { resolveUnambiguousViteImportPath } from "../../utils/resolve-relative-import-path.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { resolveImportedExportName } from "../../utils/find-exported-function-body.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../utils/resolve-cross-file-function-export.js";
import { isOwnedRequestMapReset } from "./utils/is-owned-request-map-reset.js";
import { isReleasedObjectUrlStateWrite } from "./utils/is-released-object-url-state-write.js";
import { isOnlyCalledInEffect } from "./utils/is-only-called-in-effect.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  collectEffectStateWriteFacts,
  type EffectStateWriteFact,
} from "./utils/collect-effect-state-write-facts.js";
import { getRef, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getEffectDepsRefs, hasCleanup, isProp, isState } from "./utils/effect/react.js";
import { hasDeferredOrExternalEffectWork } from "./utils/has-deferred-or-external-effect-work.js";
import { hasResourceLifecycleSetterWriter } from "./utils/has-resource-lifecycle-setter-writer.js";

import { isPortalMountStateWrite } from "./utils/is-portal-mount-state-write.js";

const isDirectNamedReactCall = (
  node: EsTreeNode,
  name: "useState" | "useEffect",
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const binding = scopes.symbolFor(node.callee);
  return Boolean(
    binding &&
    isNodeOfType(binding.declarationNode, "ImportSpecifier") &&
    getImportDeclarationForSymbol(binding)?.source.value === "react" &&
    isReactApiCall(node, name, scopes),
  );
};

const isIgnoredCallbackUse = (identifier: EsTreeNode): boolean => {
  const call = identifier.parent;
  return (
    isNodeOfType(call, "CallExpression") &&
    call.callee === identifier &&
    isNodeOfType(call.parent, "ExpressionStatement")
  );
};

const isOutwardOnlyHookFunction = (
  owner: EsTreeNode,
  returnedObject: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(owner, "ArrowFunctionExpression") ||
    !isNodeOfType(owner.parent, "VariableDeclarator") ||
    owner.parent.init !== owner
  )
    return false;
  const binding = getFunctionBindingIdentifier(owner);
  const symbol = binding ? scopes.symbolFor(binding) : null;
  if (symbol?.kind !== "const") return false;
  const [firstReference] = symbol.references;
  const property = firstReference?.identifier.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.parent !== returnedObject ||
    !isNodeOfType(property.value, "Identifier") ||
    scopes.symbolFor(property.value)?.id !== symbol.id
  )
    return false;
  // Oxc may expose distinct identifier nodes for the key and value of a shorthand.
  return symbol.references.every(
    ({ identifier, flag }) =>
      flag === "read" &&
      identifier.parent === property &&
      (property.value === identifier || (property.shorthand && property.key === identifier)),
  );
};

const getLocalWriterOwner = (
  write: EsTreeNode,
  provider: EsTreeNode,
  returnedObject: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let owner = findEnclosingFunction(write);
  while (isFunctionLike(owner) && owner !== provider) {
    const parentOwner = findEnclosingFunction(owner);
    if (parentOwner === provider) {
      if (isOutwardOnlyHookFunction(owner, returnedObject, scopes)) return owner;
      const hookCall = owner.parent;
      return isNodeOfType(hookCall, "CallExpression") &&
        hookCall.arguments[0] === owner &&
        isDirectNamedReactCall(hookCall, "useEffect", scopes)
        ? owner
        : null;
    }
    if (
      !isNodeOfType(owner, "FunctionDeclaration") &&
      (!isNodeOfType(owner.parent, "VariableDeclarator") || owner.parent.init !== owner)
    )
      return null;
    const binding = getFunctionBindingIdentifier(owner);
    const local = binding ? scopes.symbolFor(binding) : null;
    if (!local || local.references.length !== 1) return null;
    const [reference] = local.references;
    const call = reference?.identifier.parent;
    if (
      reference?.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      findEnclosingFunction(call) !== parentOwner
    )
      return null;
    owner = parentOwner;
  }
  return null;
};

const isIndependentReturnedState = (
  provider: EsTreeNode,
  scopes: ScopeAnalysis,
  field: string,
): boolean => {
  if (
    !isFunctionLike(provider) ||
    provider.async ||
    provider.generator ||
    !isNodeOfType(provider.body, "BlockStatement")
  )
    return false;
  const returns = collectFunctionReturnStatements(provider);
  const [returned] = returns;
  if (
    returns.length !== 1 ||
    !returned ||
    returned !== provider.body.body.at(-1) ||
    !isNodeOfType(returned.argument, "ObjectExpression")
  )
    return false;
  const returnedObject = returned.argument;
  const notificationOwners = new Set<EsTreeNode>();
  for (const param of provider.params) {
    if (!isNodeOfType(param, "Identifier")) return false;
    const binding = scopes.symbolFor(param);
    if (!binding) return false;
    for (const { identifier, flag } of binding.references) {
      const owner = findEnclosingFunction(identifier);
      if (
        flag !== "read" ||
        !isIgnoredCallbackUse(identifier) ||
        !owner ||
        findEnclosingFunction(owner) !== provider ||
        !isOutwardOnlyHookFunction(owner, returnedObject, scopes)
      )
        return false;
      notificationOwners.add(owner);
    }
  }
  const fields = returnedObject.properties;
  if (
    !fields.every(
      (prop) =>
        isNodeOfType(prop, "Property") &&
        !prop.computed &&
        prop.kind === "init" &&
        getStaticPropertyKeyName(prop) !== "__proto__",
    )
  )
    return false;
  const matches = fields.filter((prop) => getStaticPropertyKeyName(prop) === field);
  const [current] = matches;
  if (
    matches.length !== 1 ||
    !isNodeOfType(current, "Property") ||
    !isNodeOfType(current.value, "Identifier")
  )
    return false;
  const state = scopes.symbolFor(current.value);
  const declaration = state?.declarationNode;
  if (
    state?.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.parent?.parent !== provider.body ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    declaration.id.elements[0] !== state.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isDirectNamedReactCall(declaration.init, "useState", scopes) ||
    declaration.init.arguments.length !== 1 ||
    !isNodeOfType(declaration.init.arguments[0], "Literal") ||
    declaration.init.arguments[0].value !== null
  )
    return false;
  const setter = declaration.id.elements[1];
  if (!isNodeOfType(setter, "Identifier")) return false;
  const setterBinding = scopes.symbolFor(setter);
  if (
    !setterBinding ||
    !setterBinding.references.every(({ identifier, flag }) => {
      if (flag !== "read" || !isIgnoredCallbackUse(identifier)) return false;
      const owner = getLocalWriterOwner(identifier, provider, returnedObject, scopes);
      return owner !== null && !notificationOwners.has(owner);
    })
  )
    return false;
  let hasUnknownArgumentsUse = false;
  walkAst(provider.body, (child) => {
    if (hasUnknownArgumentsUse) return false;
    if (
      isNodeOfType(child, "Identifier") &&
      (child.name === "arguments" || child.name === "eval") &&
      scopes.isGlobalReference(child)
    ) {
      hasUnknownArgumentsUse = true;
      return false;
    }
  });
  return !hasUnknownArgumentsUse;
};

const isImportedIndependentStateField = (
  identifier: EsTreeNode,
  context: RuleContext,
  providerScopes: WeakMap<EsTreeNode, ScopeAnalysis>,
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  if (
    symbol?.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !isNodeOfType(symbol.bindingIdentifier.parent, "Property") ||
    symbol.bindingIdentifier.parent.parent !== declaration.id ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isNodeOfType(declaration.init.callee, "Identifier") ||
    !isReactHookName(declaration.init.callee.name) ||
    !context.filename
  )
    return false;
  const field = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (!field) return false;
  const binding = context.scopes.symbolFor(declaration.init.callee);
  if (!binding || !isNodeOfType(binding.declarationNode, "ImportSpecifier")) return false;
  const importDeclaration = getImportDeclarationForSymbol(binding);
  const specifier = binding.declarationNode;
  const source = importDeclaration?.source.value;
  if (
    !importDeclaration ||
    importDeclaration.importKind === "type" ||
    specifier.importKind === "type" ||
    typeof source !== "string" ||
    !(source.startsWith("./") || source.startsWith("../"))
  )
    return false;
  const exportedName = resolveImportedExportName(specifier);
  if (!exportedName) return false;
  const directFile = resolveUnambiguousViteImportPath(context.filename, source);
  if (!directFile) return false;
  const provider = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    source,
    exportedName,
  );
  if (
    !provider ||
    provider.filePath !== directFile ||
    !isNodeOfType(provider.functionNode, "FunctionDeclaration") ||
    !isNodeOfType(provider.functionNode.parent, "ExportNamedDeclaration") ||
    !isNodeOfType(provider.functionNode.id, "Identifier")
  )
    return false;
  let scopes = providerScopes.get(provider.programNode);
  if (!scopes) {
    scopes = analyzeScopes(provider.programNode);
    providerScopes.set(provider.programNode, scopes);
  }
  // The function has a distinct self binding inside its body.
  const providerSymbol = scopes.rootScope.symbolsByName.get(provider.functionNode.id.name);
  const selfSymbol = scopes
    .ownScopeFor(provider.functionNode)
    ?.symbols.find((candidate) => candidate.declarationNode === provider.functionNode);
  return Boolean(
    providerSymbol?.declarationNode === provider.functionNode &&
    providerSymbol.references.length === 0 &&
    (!selfSymbol || selfSymbol.references.length === 0) &&
    isIndependentReturnedState(provider.functionNode, scopes, field),
  );
};

const writesPropDerivedValue = (analysis: ProgramAnalysis, fact: EffectStateWriteFact): boolean => {
  if (fact.writesPropDerivedMemberValue) return true;
  if (
    fact.sourceReferences.some((reference) =>
      getUpstreamRefs(analysis, reference).some((upstreamReference) =>
        isProp(analysis, upstreamReference),
      ),
    )
  ) {
    return true;
  }
  const writtenValue = fact.writeSite.value;
  if (!writtenValue) return false;
  let currentExpression = stripParenExpression(writtenValue as EsTreeNode);
  if (isFunctionLike(currentExpression) && "body" in currentExpression) {
    const functionBody: EsTreeNode = currentExpression.body;
    let readsPropDerivedValue = false;
    walkAst(functionBody, (child): boolean | void => {
      if (readsPropDerivedValue) return false;
      if (child !== functionBody && isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "Identifier")) return;
      const reference = getRef(analysis, child);
      if (
        reference &&
        getUpstreamRefs(analysis, reference).some((upstreamReference) =>
          isProp(analysis, upstreamReference),
        )
      ) {
        readsPropDerivedValue = true;
        return false;
      }
    });
    return readsPropDerivedValue;
  }
  if (currentExpression.type !== "MemberExpression") return false;
  while (currentExpression.type === "MemberExpression") {
    currentExpression = stripParenExpression(currentExpression.object as EsTreeNode);
  }
  if (currentExpression.type !== "Identifier") return false;
  const reference = getRef(analysis, currentExpression);
  return Boolean(
    reference &&
    getUpstreamRefs(analysis, reference).some((upstreamReference) =>
      isProp(analysis, upstreamReference),
    ),
  );
};

export const noAdjustStateOnPropChange = defineRule({
  id: "no-adjust-state-on-prop-change",
  title: "State adjusted after a prop changes",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Remove the adjustment effect by deriving values during render, resetting the component with a key, or updating related state in the event that changes the prop. Avoid tracking the previous prop in more state, which preserves the duplication. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes",
  create: (context: RuleContext) => {
    const mediaReceiverCache = new WeakMap<SymbolDescriptor, boolean>();
    const importedProviderScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactHookCall(node, EFFECT_HOOK_NAMES, context.scopes)) return;
        const analysis = getProgramAnalysis(node);
        if (!analysis) return;
        const dependencyReferences = getEffectDepsRefs(analysis, node);
        if (!dependencyReferences) return;
        const hasPropDependency = dependencyReferences.some(
          (dependency) =>
            !isState(analysis, dependency) &&
            getUpstreamRefs(analysis, dependency).some(
              (reference) =>
                isProp(analysis, reference) && !isOnlyCalledInEffect(reference, node, analysis),
            ) &&
            !isImportedIndependentStateField(
              dependency.identifier as unknown as EsTreeNode,
              context,
              importedProviderScopes,
            ),
        );
        if (!hasPropDependency) return;
        const facts = collectEffectStateWriteFacts(analysis, context, node, context.filename, true);
        if (hasCleanup(analysis, node)) return;
        for (const fact of facts) {
          if (
            fact.isDeferred ||
            isOwnedRequestMapReset(fact.writeSite, context) ||
            isPortalMountStateWrite(fact.writeSite, context) ||
            isReleasedObjectUrlStateWrite(fact.writeSite, context) ||
            hasDeferredOrExternalEffectWork(analysis, node, context, fact.writeSite)
          ) {
            continue;
          }
          if (
            hasResourceLifecycleSetterWriter(
              analysis,
              context,
              fact.setterReference,
              node,
              dependencyReferences,
              fact.matchesStateInitializer,
              mediaReceiverCache,
              fact.isForwardedWrite ? fact.writeSite : undefined,
            )
          ) {
            continue;
          }
          const isEventOwnedPropDerivedAdjustment =
            fact.hasIndependentWriter &&
            fact.readsWrittenState &&
            writesPropDerivedValue(analysis, fact);
          if (
            (!fact.isSynchronousRenderValue && !isEventOwnedPropDerivedAdjustment) ||
            fact.resetsSourceState
          ) {
            continue;
          }
          const writtenValueHasPropSource = fact.sourceReferences
            .flatMap((reference) => getUpstreamRefs(analysis, reference))
            .some((reference) => isProp(analysis, reference));
          if (writtenValueHasPropSource && !isEventOwnedPropDerivedAdjustment) {
            continue;
          }
          context.report({
            node: fact.writeSite.node,
            message: "Adjusting state in an effect after a prop changes costs an extra render.",
          });
        }
      },
    };
  },
});
