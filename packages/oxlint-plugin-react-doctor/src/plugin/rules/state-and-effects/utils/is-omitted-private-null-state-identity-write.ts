import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isPropOmittedByPrivateJsxConsumers } from "../../../utils/is-prop-omitted-by-private-jsx-consumers.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";

const nullValue = (node: EsTreeNode | null | undefined): boolean =>
  !!node &&
  isNodeOfType(stripParenExpression(node), "Literal") &&
  (stripParenExpression(node) as EsTreeNode & { value: unknown }).value === null;

const isDirectNamedReactHook = (call: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const binding = scopes.symbolFor(call.callee);
  const specifier = binding?.declarationNode;
  const declaration = specifier?.parent;
  return (
    binding?.kind === "import" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.source.value === "react" &&
    getImportedName(specifier) === name
  );
};

// All other writes must preserve null or sit behind the omitted activation prop.
export const isOmittedPrivateNullStateIdentityWrite = (
  node: EsTreeNode,
  context: Pick<RuleContext, "scopes" | "filename">,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.arguments.length !== 1
  )
    return false;
  const scopes = context.scopes;
  const setter = scopes.symbolFor(node.callee);
  const binding = setter?.bindingIdentifier;
  const tuple = binding?.parent;
  const declaration = tuple?.parent;
  if (
    !setter ||
    setter.kind !== "const" ||
    !isNodeOfType(tuple, "ArrayPattern") ||
    tuple.elements.length !== 2 ||
    tuple.elements[1] !== binding ||
    !isNodeOfType(tuple.elements[0], "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== tuple ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    declaration.init.arguments.length !== 1 ||
    !nullValue(declaration.init.arguments[0]) ||
    !isDirectNamedReactHook(declaration.init, "useState", scopes)
  )
    return false;
  const component = findEnclosingFunction(declaration);
  const state = scopes.symbolFor(tuple.elements[0]);
  const updater = stripParenExpression(node.arguments[0]);
  if (
    !component ||
    !isFunctionLike(component) ||
    !state ||
    !hasCompleteSymbolReferences(setter, component, scopes) ||
    !hasCompleteSymbolReferences(state, component, scopes) ||
    state.references.some(
      (ref) => ref.flag !== "read" || isWithinAssignmentTarget(ref.identifier),
    ) ||
    !isNodeOfType(updater, "ArrowFunctionExpression") ||
    updater.async ||
    updater.params.length !== 1 ||
    !isNodeOfType(updater.params[0], "Identifier") ||
    !isNodeOfType(stripParenExpression(updater.body), "ConditionalExpression")
  )
    return false;
  const current = scopes.symbolFor(updater.params[0]);
  const choice = stripParenExpression(updater.body);
  if (!isNodeOfType(choice, "ConditionalExpression")) return false;
  const test = stripParenExpression(choice.test);
  const alternate = stripParenExpression(choice.alternate);
  if (
    !current ||
    !isNodeOfType(test, "BinaryExpression") ||
    test.operator !== "===" ||
    !isNodeOfType(test.left, "Identifier") ||
    scopes.symbolFor(test.left) !== current ||
    !isNodeOfType(test.right, "Identifier") ||
    !nullValue(choice.consequent) ||
    !isNodeOfType(alternate, "Identifier") ||
    scopes.symbolFor(alternate) !== current
  )
    return false;
  const snapshot = scopes.symbolFor(test.right);
  const captured = snapshot ? getDirectConstInitializer(snapshot) : null;
  if (
    !snapshot ||
    !isNodeOfType(captured, "MemberExpression") ||
    captured.computed ||
    captured.optional ||
    !isNodeOfType(captured.property, "Identifier") ||
    captured.property.name !== "current" ||
    !isNodeOfType(captured.object, "Identifier")
  )
    return false;
  const cell = scopes.symbolFor(captured.object);
  const init = cell ? getDirectConstInitializer(cell) : null;
  if (
    !cell ||
    findEnclosingFunction(cell.bindingIdentifier) !== component ||
    !hasCompleteSymbolReferences(cell, component, scopes) ||
    !isNodeOfType(init, "CallExpression") ||
    init.optional ||
    init.arguments.length !== 1 ||
    !nullValue(init.arguments[0]) ||
    !isDirectNamedReactHook(init, "useRef", scopes)
  )
    return false;

  // The only accepted control source is an original plain destructured prop.
  const props = component.params[0];
  if (!isNodeOfType(props, "ObjectPattern")) return false;
  const candidates: Array<{ symbol: SymbolDescriptor; name: string }> = [];
  for (const property of props.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier")
    )
      continue;
    const symbol = scopes.symbolFor(property.value);
    if (
      symbol &&
      hasCompleteSymbolReferences(symbol, component, scopes) &&
      symbol.references.every(
        (ref) => ref.flag === "read" && !isWithinAssignmentTarget(ref.identifier),
      )
    )
      candidates.push({ symbol, name: property.key.name });
  }
  const isGuarded = (write: EsTreeNode, prop: SymbolDescriptor): boolean => {
    for (
      let parent: EsTreeNode | undefined = write;
      parent && parent !== component;
      parent = parent.parent ?? undefined
    ) {
      if (!isFunctionLike(parent) || !isNodeOfType(parent.body, "BlockStatement")) continue;
      const statements = parent.body.body;
      for (const statement of statements) {
        if (statement.range[0] >= write.range[0]) break;
        if (!isNodeOfType(statement, "IfStatement") || statement.alternate) continue;
        const test = stripParenExpression(statement.test);
        const first =
          isNodeOfType(test, "LogicalExpression") && test.operator === "||"
            ? stripParenExpression(test.left)
            : test;
        if (
          !isNodeOfType(first, "UnaryExpression") ||
          first.operator !== "!" ||
          !isNodeOfType(first.argument, "Identifier") ||
          scopes.symbolFor(first.argument) !== prop
        )
          continue;
        const consequent = statement.consequent;
        const returns =
          (isNodeOfType(consequent, "ReturnStatement") && !consequent.argument) ||
          (isNodeOfType(consequent, "BlockStatement") &&
            consequent.body.length === 1 &&
            isNodeOfType(consequent.body[0], "ReturnStatement") &&
            !consequent.body[0].argument);
        if (!returns) continue;
        // A hoisted nested callback must not be published before the return guard.
        // Permit only direct snapshots of this same null-owned cell before it.
        const prefixSafe = statements.slice(0, statements.indexOf(statement)).every((prior) => {
          if (!isNodeOfType(prior, "VariableDeclaration") || prior.kind !== "const") return false;
          return prior.declarations.every((decl) => {
            if (!isNodeOfType(decl.id, "Identifier") || !decl.init) return false;
            const value = stripParenExpression(decl.init);
            return (
              isNodeOfType(value, "MemberExpression") &&
              !value.computed &&
              !value.optional &&
              isNodeOfType(value.object, "Identifier") &&
              scopes.symbolFor(value.object) === cell &&
              isNodeOfType(value.property, "Identifier") &&
              value.property.name === "current"
            );
          });
        });
        if (prefixSafe) return true;
      }
    }
    return false;
  };
  let dynamicScope = false;
  walkAst(component, (child) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === "eval"
    )
      dynamicScope = true;
    if (isNodeOfType(child, "Identifier") && child.name === "arguments") dynamicScope = true;
  });
  if (dynamicScope) return false;
  return candidates.some((prop) => {
    if (
      !setter.references.every(({ identifier, flag }) => {
        const call = identifier.parent;
        if (
          flag !== "read" ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.callee !== identifier ||
          call.arguments.length !== 1
        )
          return false;
        return call === node || nullValue(call.arguments[0]) || isGuarded(call, prop.symbol);
      })
    )
      return false;
    if (
      !cell.references.every(({ identifier, flag }) => {
        const member = identifier.parent;
        if (
          flag !== "read" ||
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== identifier ||
          member.computed ||
          member.optional ||
          !isNodeOfType(member.property, "Identifier") ||
          member.property.name !== "current"
        )
          return false;
        const use = member.parent;
        if (isNodeOfType(use, "AssignmentExpression") && use.left === member)
          return use.operator === "=" && (nullValue(use.right) || isGuarded(use, prop.symbol));
        return (
          !isWithinAssignmentTarget(member) &&
          !(
            isNodeOfType(use, "UpdateExpression") ||
            (isNodeOfType(use, "UnaryExpression") && use.operator === "delete")
          )
        );
      })
    )
      return false;
    return isPropOmittedByPrivateJsxConsumers(component, scopes, context.filename, prop.name);
  });
};
