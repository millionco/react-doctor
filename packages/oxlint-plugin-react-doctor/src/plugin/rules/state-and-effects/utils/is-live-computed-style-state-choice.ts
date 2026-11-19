import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { resolveStateSetterReference } from "./effect/react.js";

const computedStyleMethod = "getComputedStyle";
const styleFields = new Set(["display", "flexDirection"]);
const providerInterferenceByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasVisibleProviderInterference = (scopes: ScopeAnalysis): boolean => {
  const cached = providerInterferenceByScope.get(scopes);
  if (cached !== undefined) return cached;
  let didFindInterference = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (didFindInterference || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
    ) {
      didFindInterference = true;
      return false;
    }
    if (isNodeOfType(node, "Literal") && node.value === computedStyleMethod) {
      const member = node.parent;
      if (!isNodeOfType(member, "MemberExpression") || member.property !== node) {
        didFindInterference = true;
      }
      return;
    }
    if (
      getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true }) !==
      computedStyleMethod
    ) {
      return;
    }
    const expression = findTransparentExpressionRoot(node);
    const call = expression.parent;
    if (
      !isNodeOfType(node, "MemberExpression") ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== expression
    ) {
      // Also rejects recognizable writes through indirect realm aliases.
      didFindInterference = true;
    }
  });
  providerInterferenceByScope.set(scopes, didFindInterference);
  return didFindInterference;
};

const getReadOnlySymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  return symbol &&
    isSymbolReadOnly(symbol) &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
    ? symbol
    : null;
};

const getConstInitializer = (identifier: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  const symbol = getReadOnlySymbol(identifier, scopes);
  return symbol ? getDirectConstInitializer(symbol) : null;
};

const getChoiceRoot = (call: EsTreeNode): EsTreeNodeOfType<"IfStatement"> | null => {
  const expression = findTransparentExpressionRoot(call);
  const statement = expression.parent;
  if (!isNodeOfType(statement, "ExpressionStatement") || statement.expression !== expression)
    return null;
  const body = isNodeOfType(statement.parent, "BlockStatement") ? statement.parent : statement;
  let branch = body.parent;
  if (
    !isNodeOfType(branch, "IfStatement") ||
    (branch.consequent !== body && branch.alternate !== body)
  )
    return null;
  while (isNodeOfType(branch.parent, "IfStatement") && branch.parent.alternate === branch) {
    branch = branch.parent;
  }
  return branch;
};

const readArm = (
  arm: EsTreeNode,
  analysis: ProgramAnalysis,
  context: RuleContext,
  fact: EffectStateWriteFact,
) => {
  const statement = isNodeOfType(arm, "BlockStatement")
    ? arm.body.length === 1
      ? arm.body[0]
      : null
    : arm;
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const call = stripParenExpression(statement.expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1)
    return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = getRef(analysis, callee);
  if (
    !reference ||
    resolveStateSetterReference(analysis, reference)?.resolved !== fact.setterReference.resolved
  )
    return null;
  const argument = call.arguments[0];
  if (!argument) return null;
  let value = stripParenExpression(argument);
  if (isNodeOfType(value, "Identifier")) {
    const initializer = getConstInitializer(value, context.scopes);
    if (!initializer) return null;
    value = stripParenExpression(initializer);
  }
  return isNodeOfType(value, "Literal") &&
    (value.value === null ||
      typeof value.value === "string" ||
      typeof value.value === "number" ||
      typeof value.value === "boolean")
    ? { call, value: value.value }
    : null;
};

const readStyleComparison = (expression: EsTreeNode, scopes: ScopeAnalysis) => {
  const test = stripParenExpression(expression);
  if (!isNodeOfType(test, "BinaryExpression") || test.operator !== "===") return null;
  const read = stripParenExpression(test.left);
  const compared = stripParenExpression(test.right);
  if (
    !isNodeOfType(read, "MemberExpression") ||
    read.optional ||
    read.computed ||
    !isNodeOfType(read.property, "Identifier") ||
    !styleFields.has(read.property.name) ||
    !isNodeOfType(compared, "Literal") ||
    typeof compared.value !== "string"
  ) {
    return null;
  }
  const receiver = stripParenExpression(read.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const style = getReadOnlySymbol(receiver, scopes);
  return style ? { style, receiver, property: read.property.name, value: compared.value } : null;
};

const readStyleCondition = (expression: EsTreeNode, scopes: ScopeAnalysis) => {
  const test = stripParenExpression(expression);
  if (!isNodeOfType(test, "LogicalExpression") || test.operator !== "&&") {
    const comparison = readStyleComparison(test, scopes);
    return comparison ? [comparison] : null;
  }
  const first = readStyleComparison(test.left, scopes);
  const second = readStyleComparison(test.right, scopes);
  return first && second && first.style === second.style && first.property !== second.property
    ? [first, second]
    : null;
};

const hasDominatingNativeStyleRead = (
  style: SymbolDescriptor,
  root: EsTreeNode,
  comparisonReceivers: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const initializer = getDirectConstInitializer(style);
  const call = initializer ? stripParenExpression(initializer) : null;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    isNodeOfType(call.arguments[0], "SpreadElement") ||
    findEnclosingFunction(call) !== findEnclosingFunction(root) ||
    !nodeDominatesNode(call, root, context) ||
    !style.references.every(
      ({ identifier }) =>
        comparisonReceivers.has(identifier) || isKeyedDraftTypeReference(identifier),
    )
  ) {
    return false;
  }
  const callee = stripParenExpression(call.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    !callee.computed &&
    callee.property.name === computedStyleMethod &&
    isProvenUnmodifiedGlobalNamespaceReference(
      callee,
      computedStyleMethod,
      context.scopes,
      undefined,
      true,
    ) &&
    !hasVisibleProviderInterference(context.scopes)
  );
};

export const isLiveComputedStyleStateChoice = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  fact: EffectStateWriteFact,
): boolean => {
  if (!fact.setterReference.resolved) return false;
  const root = getChoiceRoot(fact.callExpression);
  if (!root) return false;

  const comparisonReceivers = new Set<EsTreeNode>();
  const testedValues = new Set<string>();
  const writtenValues = new Set<string | number | boolean | null>();
  let foundWrite = false;
  let style: SymbolDescriptor | null = null;
  let selector: string | null = null;
  let branch = root;
  while (true) {
    const comparisons = readStyleCondition(branch.test, context.scopes);
    const first = comparisons?.[0];
    const arm = readArm(branch.consequent, analysis, context, fact);
    if (!comparisons || !first || !arm || !branch.alternate) return false;
    style ??= first.style;
    selector ??= first.property;
    if (first.style !== style || first.property !== selector || testedValues.has(first.value)) {
      return false;
    }
    testedValues.add(first.value);
    for (const comparison of comparisons) comparisonReceivers.add(comparison.receiver);
    writtenValues.add(arm.value);
    foundWrite ||= arm.call === fact.callExpression;
    if (!isNodeOfType(branch.alternate, "IfStatement")) break;
    branch = branch.alternate;
  }
  if (!branch.alternate) return false;
  const fallback = readArm(branch.alternate, analysis, context, fact);
  if (!fallback) return false;
  writtenValues.add(fallback.value);
  return (
    (foundWrite || fallback.call === fact.callExpression) &&
    writtenValues.size > 1 &&
    style !== null &&
    hasDominatingNativeStyleRead(style, root, comparisonReceivers, context)
  );
};
