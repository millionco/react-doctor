import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectFunctionBindingIdentifier } from "../../../utils/get-direct-function-binding-identifier.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";

// A private ref records the last committed mode. While that mode remains
// truthy, this state deliberately retains the value captured on entry.
// No assertion about an imported scheduler is needed for that distinction.
export const isCommittedModeValueHold = (
  context: RuleContext,
  effect: EsTreeNode,
  reportedCall: EsTreeNode,
  stateDeclarator: EsTreeNode,
): boolean => {
  const scopes = context.scopes;
  let program: EsTreeNode = effect;
  while (program.parent) program = program.parent;
  // Defer cached whole-file probes until the exact transition shape qualifies.
  const requiredSymbols = new Set<SymbolDescriptor>();
  const readonly = (symbol: SymbolDescriptor): boolean => {
    requiredSymbols.add(symbol);
    return symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
  };
  const same = (node: EsTreeNode | null | undefined, symbol: SymbolDescriptor): boolean =>
    Boolean(node && isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol);
  const refsAre = (symbol: SymbolDescriptor, nodes: ReadonlyArray<EsTreeNode>): boolean => {
    if (!readonly(symbol) || symbol.references.length !== nodes.length) return false;
    const expectedNodes = new Set(nodes);
    return symbol.references.every((reference) => expectedNodes.has(reference.identifier));
  };

  const hook = (node: EsTreeNode | null | undefined, name: string): boolean => {
    if (
      !node ||
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      !isNodeOfType(node.callee, "Identifier")
    )
      return false;
    const symbol = scopes.symbolFor(node.callee);
    if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return false;
    const declaration = symbol.declarationNode.parent;
    return Boolean(
      declaration &&
      isNodeOfType(declaration, "ImportDeclaration") &&
      declaration.source.value === "react" &&
      declaration.importKind !== "type" &&
      symbol.declarationNode.importKind !== "type" &&
      getImportedName(symbol.declarationNode) === name &&
      readonly(symbol) &&
      symbol.references.every((reference) => {
        const parent = reference.identifier.parent;
        return (
          parent &&
          isNodeOfType(parent, "CallExpression") &&
          parent.callee === reference.identifier &&
          !parent.optional
        );
      }),
    );
  };
  if (
    !isNodeOfType(effect, "CallExpression") ||
    !hook(effect, "useEffect") ||
    effect.arguments.length !== 2 ||
    !isNodeOfType(effect.arguments[0], "ArrowFunctionExpression") ||
    effect.arguments[0].async ||
    effect.arguments[0].params.length !== 0 ||
    !isNodeOfType(effect.arguments[0].body, "BlockStatement") ||
    !isNodeOfType(effect.arguments[1], "ArrayExpression")
  )
    return false;
  const callback = effect.arguments[0];
  const component = findEnclosingFunction(effect);
  if (
    !component ||
    (!isNodeOfType(component, "ArrowFunctionExpression") &&
      !isNodeOfType(component, "FunctionExpression") &&
      !isNodeOfType(component, "FunctionDeclaration")) ||
    !isNodeOfType(component.body, "BlockStatement") ||
    !isNodeOfType(effect.parent, "ExpressionStatement") ||
    effect.parent.parent !== component.body ||
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    stateDeclarator.id.elements.length !== 2 ||
    !stateDeclarator.init ||
    !hook(stateDeclarator.init, "useState") ||
    !isNodeOfType(stateDeclarator.parent, "VariableDeclaration") ||
    stateDeclarator.parent.kind !== "const" ||
    stateDeclarator.parent.parent !== component.body
  )
    return false;
  // Only a public custom-hook entry point can supply the open mode domain.
  // A closed local wrapper (including a visible always-NaN call) is not proof
  // that the retained-value branch can distinguish any real invocation.
  const ownerBinding = getDirectFunctionBindingIdentifier(component);
  if (!ownerBinding || !isReactHookName(ownerBinding.name)) return false;
  const ownerSymbol = scopes.symbolFor(ownerBinding);
  if (!ownerSymbol || !refsAre(ownerSymbol, [])) return false;
  let ownerDeclaration: EsTreeNode = component;
  if (!isNodeOfType(component, "FunctionDeclaration")) {
    const declarator = component.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== component ||
      declarator.id !== ownerBinding ||
      !isNodeOfType(declarator.parent, "VariableDeclaration") ||
      declarator.parent.kind !== "const" ||
      declarator.parent.declarations.length !== 1
    )
      return false;
    ownerDeclaration = declarator.parent;
  }
  const exportDeclaration = ownerDeclaration.parent;
  if (
    !exportDeclaration ||
    !isNodeOfType(exportDeclaration, "ExportNamedDeclaration") ||
    exportDeclaration.declaration !== ownerDeclaration ||
    !isNodeOfType(exportDeclaration.parent, "Program")
  )
    return false;

  const [stateNode, setterNode] = stateDeclarator.id.elements;
  if (
    !stateNode ||
    !setterNode ||
    !isNodeOfType(stateNode, "Identifier") ||
    !isNodeOfType(setterNode, "Identifier")
  )
    return false;
  const state = scopes.symbolFor(stateNode);
  const setter = scopes.symbolFor(setterNode);
  if (!state || !setter || !readonly(setter)) return false;
  const last = component.body.body.at(-1);
  if (
    !last ||
    !isNodeOfType(last, "ReturnStatement") ||
    !last.argument ||
    !same(last.argument, state) ||
    !refsAre(state, [last.argument])
  )
    return false;
  // Match the closed effect: prior mode, numeric sample, transition/idle, commit.
  const body = callback.body;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length !== 4) return false;
  const [previousStatement, sampleStatement, branch, commit] = body.body;
  const constDeclaration = (statement: EsTreeNode): EsTreeNode | null => {
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== 1
    )
      return null;
    const declaration = statement.declarations[0];
    return isNodeOfType(declaration.id, "Identifier") && declaration.init ? declaration : null;
  };
  const previous = constDeclaration(previousStatement);
  const sample = constDeclaration(sampleStatement);
  if (
    !previous ||
    !sample ||
    !isNodeOfType(previous, "VariableDeclarator") ||
    !isNodeOfType(sample, "VariableDeclarator") ||
    !previous.init ||
    !sample.init ||
    !isNodeOfType(previous.init, "MemberExpression") ||
    previous.init.computed ||
    previous.init.optional ||
    !isNodeOfType(previous.init.property, "Identifier") ||
    previous.init.property.name !== "current" ||
    !isNodeOfType(previous.init.object, "Identifier")
  )
    return false;
  const ref = scopes.symbolFor(previous.init.object);
  const previousSymbol = scopes.symbolFor(previous.id);
  const sampleSymbol = scopes.symbolFor(sample.id);
  if (!ref || !previousSymbol || !sampleSymbol) return false;
  requiredSymbols.add(ref);
  const refInit = getDirectConstInitializer(ref);
  if (
    !refInit ||
    !isNodeOfType(refInit, "CallExpression") ||
    !hook(refInit, "useRef") ||
    refInit.arguments.length !== 1 ||
    !isNodeOfType(refInit.arguments[0], "Identifier") ||
    !isNodeOfType(ref.declarationNode, "VariableDeclarator") ||
    ref.declarationNode.parent?.parent !== component.body
  )
    return false;
  const refRead = previous.init;
  const isReadonlyParameter = (symbol: SymbolDescriptor): boolean =>
    symbol.kind === "parameter" &&
    component.params.some((parameter) => parameter === symbol.bindingIdentifier) &&
    readonly(symbol);
  const mode = scopes.symbolFor(refInit.arguments[0]);
  if (!mode || !isReadonlyParameter(mode)) return false;
  if (
    !isNodeOfType(branch, "IfStatement") ||
    !isNodeOfType(branch.test, "BinaryExpression") ||
    branch.test.operator !== "!==" ||
    !same(branch.test.left, mode) ||
    !same(branch.test.right, previousSymbol) ||
    !refsAre(previousSymbol, [branch.test.right]) ||
    !branch.alternate ||
    !isNodeOfType(branch.alternate, "IfStatement") ||
    branch.alternate.alternate ||
    !isNodeOfType(branch.alternate.test, "UnaryExpression") ||
    branch.alternate.test.operator !== "!" ||
    !same(branch.alternate.test.argument, mode)
  )
    return false;
  const singleCall = (statement: EsTreeNode): EsTreeNode | null => {
    if (!isNodeOfType(statement, "BlockStatement") || statement.body.length !== 1) return null;
    const onlyStatement = statement.body[0];
    return isNodeOfType(onlyStatement, "ExpressionStatement") ? onlyStatement.expression : null;
  };
  const first = singleCall(branch.consequent);
  const second = singleCall(branch.alternate.consequent);
  if (
    !first ||
    !second ||
    !isNodeOfType(first, "CallExpression") ||
    !isNodeOfType(second, "CallExpression") ||
    first.optional ||
    second.optional ||
    !same(first.callee, setter) ||
    !same(second.callee, setter) ||
    first.arguments.length !== 1 ||
    second.arguments.length !== 1 ||
    !same(first.arguments[0], sampleSymbol) ||
    !same(second.arguments[0], sampleSymbol) ||
    !refsAre(sampleSymbol, [first.arguments[0], second.arguments[0]]) ||
    reportedCall !== first
  )
    return false;
  if (
    !isNodeOfType(commit, "ExpressionStatement") ||
    !isNodeOfType(commit.expression, "AssignmentExpression") ||
    commit.expression.operator !== "=" ||
    !same(commit.expression.right, mode) ||
    !isNodeOfType(commit.expression.left, "MemberExpression") ||
    commit.expression.left.computed ||
    commit.expression.left.optional ||
    !same(commit.expression.left.object, ref) ||
    !isNodeOfType(commit.expression.left.property, "Identifier") ||
    commit.expression.left.property.name !== "current" ||
    ref.references.length !== 2
  )
    return false;
  const committedMember = commit.expression.left;
  if (
    !ref.references.every(
      (reference) =>
        reference.flag === "read" &&
        (reference.identifier === refRead.object ||
          reference.identifier === committedMember.object),
    )
  )
    return false;
  const numericSource = (node: EsTreeNode): SymbolDescriptor | null => {
    if (
      !isNodeOfType(node, "LogicalExpression") ||
      node.operator !== "||" ||
      !isNodeOfType(node.right, "Literal") ||
      typeof node.right.value !== "number" ||
      !Number.isFinite(node.right.value) ||
      !isNodeOfType(node.left, "CallExpression") ||
      node.left.optional ||
      !isNodeOfType(node.left.callee, "Identifier") ||
      node.left.callee.name !== "Number" ||
      !scopes.isGlobalReference(node.left.callee) ||
      node.left.arguments.length !== 1 ||
      !isNodeOfType(node.left.arguments[0], "Identifier")
    )
      return null;
    return scopes.symbolFor(node.left.arguments[0]);
  };
  const value = numericSource(sample.init);
  if (
    !value ||
    value === mode ||
    !isReadonlyParameter(value) ||
    !isNodeOfType(stateDeclarator.init, "CallExpression") ||
    stateDeclarator.init.arguments.length !== 1 ||
    numericSource(stateDeclarator.init.arguments[0]) !== value
  )
    return false;
  const dependencies = effect.arguments[1].elements;
  if (
    dependencies.length !== 2 ||
    !dependencies.every(
      (dependency) => dependency && (same(dependency, mode) || same(dependency, value)),
    ) ||
    !dependencies.some((dependency) => same(dependency, mode)) ||
    !dependencies.some((dependency) => same(dependency, value))
  )
    return false;
  // Other writes may only increment their own previous numeric state.
  for (const reference of setter.references) {
    if (reference.identifier === first.callee || reference.identifier === second.callee) continue;
    const call = reference.identifier.parent;
    if (
      !call ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      call.optional ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.arguments[0], "ArrowFunctionExpression")
    )
      return false;
    const updater = call.arguments[0];
    if (
      updater.async ||
      updater.params.length !== 1 ||
      !isNodeOfType(updater.params[0], "Identifier") ||
      !isNodeOfType(updater.body, "BinaryExpression") ||
      updater.body.operator !== "+" ||
      !isNodeOfType(updater.body.right, "Literal") ||
      typeof updater.body.right.value !== "number" ||
      !Number.isFinite(updater.body.right.value) ||
      updater.body.right.value === 0
    )
      return false;
    const parameter = scopes.symbolFor(updater.params[0]);
    if (
      !parameter ||
      !same(updater.body.left, parameter) ||
      !refsAre(parameter, [updater.body.left])
    )
      return false;
  }
  // The state and effect samples must both use the actual, unmodified
  // Number conversion. TypeScript annotations do not establish this domain.
  if (
    !isNodeOfType(sample.init, "LogicalExpression") ||
    !isNodeOfType(sample.init.left, "CallExpression") ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      sample.init.left.callee,
      "Number",
      scopes,
      undefined,
      true,
    )
  )
    return false;
  if (![...requiredSymbols].every((symbol) => hasCompleteSymbolReferences(symbol, program, scopes)))
    return false;

  let unsafe = false;
  walkAst(program, (node) => {
    if (unsafe) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
    )
      unsafe = true;
    if (isNodeOfType(node, "ImportDeclaration") && node.source.value === "react") {
      if (node.specifiers.some((specifier) => !isNodeOfType(specifier, "ImportSpecifier")))
        unsafe = true;
    }
  });
  return !unsafe;
};
