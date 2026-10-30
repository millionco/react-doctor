import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findExportedValue } from "../../../utils/find-exported-value.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getProjectRelativeFilename } from "../../../utils/get-project-relative-filename.js";
import {
  getReactDoctorStringSetting,
  hasCapability,
} from "../../../utils/get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { NEXTJS_PAGE_DATA_EXPORT_NAMES } from "../../../utils/nextjs-page-data-export-names.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasClosedNextPageRouterImports } from "./has-closed-next-page-router-imports.js";
import {
  NEXT_PAGE_REDIRECT_EFFECT_ARGUMENT_COUNT,
  NEXT_PAGE_REDIRECT_PAGE_FILE_PATTERN,
  NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT,
} from "./constants.js";

const isReadonlyBinding = (
  binding: SymbolDescriptor | null | undefined,
): binding is SymbolDescriptor =>
  Boolean(
    binding &&
    binding.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
    ),
  );

const hasRuntimeSelfReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  Boolean(
    scopes
      .ownScopeFor(node)
      ?.symbols.some(
        (symbol) =>
          symbol.kind === "function" &&
          symbol.declarationNode === node &&
          symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)),
      ),
  );

const hasExactPageOwner = (
  owner: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (findExportedValue(program, "default") !== owner || hasRuntimeSelfReference(owner, scopes))
    return false;
  const [binding] = getFunctionBindingSymbols(owner, scopes);
  if (!binding) return owner.parent?.type === "ExportDefaultDeclaration";
  return (
    (binding.kind === "const" ||
      (binding.kind === "function" && isNodeOfType(owner, "FunctionDeclaration"))) &&
    isReadonlyBinding(binding) &&
    binding.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const root = findTransparentExpressionRoot(reference.identifier);
      return (
        isNodeOfType(root.parent, "ExportDefaultDeclaration") && root.parent.declaration === root
      );
    })
  );
};

const plainProperties = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || properties.has(name)) return null;
    properties.set(name, property.value);
  }
  return properties;
};

const hasOwnDataPropTransport = (
  program: EsTreeNode,
  names: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.exportKind === "type")
      continue;
    const declaration = statement.declaration;
    const functions: EsTreeNode[] = [];
    if (
      isNodeOfType(declaration, "FunctionDeclaration") &&
      declaration.id &&
      NEXTJS_PAGE_DATA_EXPORT_NAMES.has(declaration.id.name)
    )
      functions.push(declaration);
    if (isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "const") {
      for (const declarator of declaration.declarations) {
        if (
          isNodeOfType(declarator.id, "Identifier") &&
          NEXTJS_PAGE_DATA_EXPORT_NAMES.has(declarator.id.name) &&
          isFunctionLike(declarator.init)
        )
          functions.push(declarator.init);
      }
    }
    for (const dataFunction of functions) {
      if (
        !isFunctionLike(dataFunction) ||
        dataFunction.generator ||
        hasRuntimeSelfReference(dataFunction, scopes)
      )
        continue;
      const [binding] = getFunctionBindingSymbols(dataFunction, scopes);
      if (
        !isReadonlyBinding(binding) ||
        binding.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
      )
        continue;
      const exportedName = binding.name;
      if (findExportedValue(program, exportedName) !== dataFunction) continue;
      let valid = true;
      let returns = 0;
      const transported = new Set<string>();
      const collectReturn = (value: EsTreeNode | null | undefined): void => {
        const outer = value ? plainProperties(stripParenExpression(value)) : null;
        const props = outer?.get("props");
        const properties = props ? plainProperties(stripParenExpression(props)) : null;
        if (!properties) {
          valid = false;
          return;
        }
        returns += NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT;
        for (const name of properties.keys()) transported.add(name);
      };
      const body = stripParenExpression(dataFunction.body);
      if (isNodeOfType(body, "ObjectExpression")) collectReturn(body);
      else
        walkAst(body, (node) => {
          if (isFunctionLike(node)) return false;
          if (isNodeOfType(node, "ReturnStatement")) collectReturn(node.argument);
        });
      if (valid && returns > 0 && [...names].every((name) => transported.has(name))) return true;
    }
  }
  return false;
};

const collectGuardBindings = (
  node: EsTreeNode,
  props: ReadonlyMap<number, string>,
  names: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    const binding = scopes.symbolFor(expression);
    const name = binding ? props.get(binding.id) : null;
    if (!name) return false;
    names.add(name);
    return true;
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!")
    return collectGuardBindings(expression.argument, props, names, scopes);
  return (
    isNodeOfType(expression, "LogicalExpression") &&
    expression.operator === "&&" &&
    collectGuardBindings(expression.left, props, names, scopes) &&
    collectGuardBindings(expression.right, props, names, scopes)
  );
};

export const isNextPageDataReplacementEffect = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  const filename = getProjectRelativeFilename(
    context.filename ?? "",
    getReactDoctorStringSetting(context.settings, "rootDirectory"),
  );
  if (
    !hasCapability(context.settings, "nextjs") ||
    !NEXT_PAGE_REDIRECT_PAGE_FILE_PATTERN.test(filename) ||
    !isNodeOfType(node, "CallExpression") ||
    node.arguments.length !== NEXT_PAGE_REDIRECT_EFFECT_ARGUMENT_COUNT ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const effect = context.scopes.symbolFor(node.callee);
  if (
    !effect ||
    getValueImportSource(effect) !== "react" ||
    getImportedName(effect.declarationNode) !== "useEffect"
  )
    return false;
  const callback = stripParenExpression(node.arguments[0]);
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator ||
    callback.params.length > 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT
  )
    return false;
  const condition = callback.body.body[0];
  if (!isNodeOfType(condition, "IfStatement") || condition.alternate) return false;
  const consequent = isNodeOfType(condition.consequent, "BlockStatement")
    ? condition.consequent.body
    : [condition.consequent];
  if (
    consequent.length !== NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT ||
    !isNodeOfType(consequent[0], "ExpressionStatement")
  )
    return false;
  const navigation = stripParenExpression(consequent[0].expression);
  if (
    !isNodeOfType(navigation, "CallExpression") ||
    navigation.optional ||
    navigation.arguments.length !== NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT ||
    !isNodeOfType(navigation.arguments[0], "Identifier") ||
    !isNodeOfType(navigation.callee, "MemberExpression") ||
    navigation.callee.optional ||
    navigation.callee.computed ||
    getStaticPropertyName(navigation.callee) !== "replace" ||
    !isNodeOfType(navigation.callee.object, "Identifier")
  )
    return false;
  const owner = findEnclosingFunction(node);
  const program = context.scopes.rootScope.node;
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT ||
    !isNodeOfType(owner.params[0], "ObjectPattern") ||
    !hasExactPageOwner(owner, program, context.scopes)
  )
    return false;
  const statement = findTransparentExpressionRoot(node).parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.parent !== owner.body ||
    !isNodeReachableWithinFunction(node, context)
  )
    return false;
  const props = new Map<number, string>();
  for (const property of owner.params[0].properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    const binding = context.scopes.symbolFor(property.value);
    if (name === null || !isReadonlyBinding(binding)) return false;
    props.set(binding.id, name);
  }
  const destination = context.scopes.symbolFor(navigation.arguments[0]);
  const destinationName = destination ? props.get(destination.id) : null;
  if (!destinationName) return false;
  const names = new Set<string>([destinationName]);
  if (
    !collectGuardBindings(condition.test, props, names, context.scopes) ||
    !hasOwnDataPropTransport(program, names, context.scopes)
  )
    return false;
  const router = context.scopes.symbolFor(navigation.callee.object);
  if (
    !isReadonlyBinding(router) ||
    router.kind !== "const" ||
    !isNodeOfType(router.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(router.declarationNode.id, "Identifier") ||
    !router.initializer ||
    findEnclosingFunction(router.declarationNode) !== owner
  )
    return false;
  const initializer = stripParenExpression(router.initializer);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length > 0 ||
    !isNodeOfType(initializer.callee, "Identifier")
  )
    return false;
  const hook = context.scopes.symbolFor(initializer.callee);
  if (
    !hook ||
    getValueImportSource(hook) !== "next/router" ||
    getImportedName(hook.declarationNode) !== "useRouter"
  )
    return false;
  for (const reference of router.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (member === navigation.callee) continue;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.computed ||
      member.optional ||
      isWithinAssignmentTarget(member) ||
      getStaticPropertyName(member) !== "isFallback"
    )
      return false;
  }
  return hasClosedNextPageRouterImports(context.scopes);
};
