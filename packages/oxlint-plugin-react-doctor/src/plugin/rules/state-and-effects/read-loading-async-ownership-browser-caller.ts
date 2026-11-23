import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../../utils/build-source-project-index.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { StockViteBrowserInspection } from "../../utils/read-verified-stock-vite-browser-project.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { inspectConsumerModule } from "./inspect-direct-jsx-prop-consumer.js";
import { isTruthyJsxProperty } from "./truthy-jsx-property.js";

type Project = Pick<StockViteBrowserInspection, "index" | "closure">;
type Opening = EsTreeNodeOfType<"JSXOpeningElement">;
type Module = SourceProjectModule;
type Call = EsTreeNodeOfType<"CallExpression">;

const complete = (m: Module, s: SymbolDescriptor | null): s is SymbolDescriptor =>
  s !== null &&
  hasCompleteSymbolReferences(s, m.programNode, m.scopes) &&
  s.references.every(({ flag }) => flag === "read");

const namedBinding = (m: Module, token: EsTreeNode) => {
  const s = m.scopes.symbolFor(token);
  const item = s?.declarationNode;
  const decl = s && getImportDeclarationForSymbol(s);
  return complete(m, s) &&
    decl &&
    !isTypeOnlyImport(decl) &&
    isNodeOfType(item, "ImportSpecifier") &&
    item.importKind !== "type" &&
    isNodeOfType(item.imported, "Identifier")
    ? { decl, name: item.imported.name }
    : null;
};

const react = (m: Module, node: EsTreeNode, api: string): node is Call => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const imported = namedBinding(m, node.callee);
  return imported?.name === api && imported.decl.source.value === "react";
};

const localTarget = (p: Project, m: Module, node: EsTreeNode) => {
  const named = namedBinding(m, node);
  const file = named && p.index.resolvedSourcePathByNode.get(named.decl);
  const target = file && p.closure.reachable.has(file) && p.index.modulesByFilePath.get(file);
  return named && target ? { module: target, name: named.name } : null;
};

const ownAttribute = (tag: Opening, name: string) => {
  const matches = tag.attributes.filter(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === name,
  );
  return matches.length === 1 && isNodeOfType(matches[0], "JSXAttribute") ? matches[0] : null;
};

const jsxValue = (tag: Opening, name: string) => {
  const prop = ownAttribute(tag, name);
  return isNodeOfType(prop?.value, "JSXExpressionContainer")
    ? stripParenExpression(prop.value.expression)
    : (prop?.value ?? null);
};

const readConst = (m: Module, expr: EsTreeNode | null | undefined): SymbolDescriptor | null => {
  const value = isNodeOfType(expr, "Identifier") ? m.scopes.symbolFor(expr) : null;
  return value?.kind === "const" && complete(m, value) ? value : null;
};

const conjunction = (node: EsTreeNode): readonly EsTreeNode[] => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&"
    ? [...conjunction(expression.left), ...conjunction(expression.right)]
    : [expression];
};

const readAncestorTests = (opening: Opening): readonly EsTreeNode[] => {
  const tests: EsTreeNode[] = [];
  for (let child: EsTreeNode | null | undefined = opening.parent; child?.parent; ) {
    const parent: EsTreeNode = child.parent;
    if (isNodeOfType(parent, "ReturnStatement") || isNodeOfType(parent, "ArrowFunctionExpression"))
      break;
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === child
    )
      tests.push(...conjunction(parent.left));
    child = parent;
  }
  // inspectConsumerModule separately verifies that this JSX reaches return
  // through transparent children only.
  return tests;
};

const excludesFalsyArgument = (
  p: Project,
  caller: Module,
  call: Call,
  prop: SymbolDescriptor,
): boolean => {
  if (
    call.optional ||
    call.arguments.length !== 1 ||
    caller.scopes.symbolFor(call.arguments[0]) !== prop
  )
    return false;
  const target = localTarget(p, caller, call.callee);
  const hook = target && findExportedValue(target.module.programNode, target.name);
  if (
    !target ||
    !hook ||
    !isNodeOfType(hook, "FunctionDeclaration") ||
    hook.async ||
    hook.generator ||
    !hook.id ||
    !complete(
      target.module,
      target.module.scopes.rootScope.symbolsByName.get(hook.id.name) ?? null,
    ) ||
    hook.parent?.type !== "ExportNamedDeclaration" ||
    hook.params.length !== 1 ||
    !isNodeOfType(hook.params[0], "Identifier")
  )
    return false;
  const value = target.module.scopes.symbolFor(hook.params[0]);
  const [returned, duplicate] = collectFunctionReturnStatements(hook);
  if (
    !complete(target.module, value) ||
    !returned ||
    duplicate ||
    returned.parent !== hook.body ||
    !returned.argument ||
    !react(target.module, returned.argument, "useMemo") ||
    returned.argument.arguments.length !== 2
  )
    return false;
  const [memo, deps] = returned.argument.arguments;
  if (
    !isNodeOfType(memo, "ArrowFunctionExpression") ||
    memo.async ||
    memo.params.length !== 0 ||
    !isNodeOfType(memo.body, "BlockStatement") ||
    !isNodeOfType(deps, "ArrayExpression") ||
    !deps.elements.some((item) => item && target.module.scopes.symbolFor(item) === value)
  )
    return false;
  const first = memo.body.body[0];
  return (
    isNodeOfType(first, "IfStatement") &&
    !first.alternate &&
    isNodeOfType(first.test, "UnaryExpression") &&
    first.test.operator === "!" &&
    target.module.scopes.symbolFor(first.test.argument) === value &&
    isNodeOfType(first.consequent, "ReturnStatement") &&
    !first.consequent.argument
  );
};

const onlyEnumReads = (
  m: Module,
  s: SymbolDescriptor | null,
  names: ReadonlySet<string>,
): boolean => {
  if (!complete(m, s)) return false;
  return s.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier") ||
      !names.has(member.property.name)
    )
      return false;
    let target: EsTreeNode = findTransparentExpressionRoot(member);
    while (
      isNodeOfType(target.parent, "Property") ||
      isNodeOfType(target.parent, "ObjectPattern") ||
      isNodeOfType(target.parent, "ArrayPattern") ||
      isNodeOfType(target.parent, "RestElement") ||
      isNodeOfType(target.parent, "AssignmentPattern")
    )
      target = target.parent;
    const use = target.parent;
    return (
      !(
        (isNodeOfType(use, "AssignmentExpression") ||
          isNodeOfType(use, "ForInStatement") ||
          isNodeOfType(use, "ForOfStatement")) &&
        use.left === target
      ) &&
      !isNodeOfType(use, "UpdateExpression") &&
      !(isNodeOfType(use, "UnaryExpression") && use.operator === "delete") &&
      !(isNodeOfType(use, "CallExpression") && use.callee === target) &&
      !(isNodeOfType(use, "TaggedTemplateExpression") && use.tag === target)
    );
  });
};

const isDefinedEnumMember = (p: Project, caller: Module, expr: EsTreeNode): boolean => {
  if (!isNodeOfType(expr, "MemberExpression") || expr.optional) return false;
  const property = getStaticPropertyKeyName(expr);
  const target = localTarget(p, caller, expr.object);
  if (!property || !target) return false;
  const origin = target.module.scopes.rootScope.symbolsByName.get(target.name) ?? null;
  const decl = origin?.declarationNode;
  if (!isNodeOfType(decl, "TSEnumDeclaration") || decl.parent?.type !== "ExportNamedDeclaration")
    return false;
  if (
    target.module.programNode.body.some((statement) => {
      const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
        ? statement.declaration
        : statement;
      return (
        declaration !== decl &&
        (isNodeOfType(declaration, "TSModuleDeclaration") ||
          isNodeOfType(declaration, "TSEnumDeclaration")) &&
        isNodeOfType(declaration.id, "Identifier") &&
        declaration.id.name === target.name
      );
    })
  )
    return false;
  const members = decl.body.members;
  const names = new Set<string>();
  for (const entry of members) {
    if (
      !isNodeOfType(entry.id, "Identifier") ||
      entry.id.name === "__proto__" ||
      names.has(entry.id.name) ||
      !isNodeOfType(entry.initializer, "Literal") ||
      !["number", "string"].includes(typeof entry.initializer.value)
    )
      return false;
    names.add(entry.id.name);
  }
  if (!names.has(property) || !onlyEnumReads(target.module, origin, names)) return false;
  for (const m of p.index.consumerModulesByFilePath.get(target.module.filePath) ?? []) {
    if (!p.closure.reachable.has(m.filePath)) continue;
    let closed = true;
    walkAst(m.programNode, (node) => {
      if (p.index.resolvedSourcePathByNode.get(node) !== target.module.filePath) return;
      if (!isNodeOfType(node, "ImportDeclaration")) {
        closed = false;
        return false;
      }
      for (const specifier of node.specifiers) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) closed = false;
        else if (
          specifier.importKind !== "type" &&
          isNodeOfType(specifier.imported, "Identifier") &&
          specifier.imported.name === target.name &&
          !onlyEnumReads(m, m.scopes.symbolFor(specifier.local), names)
        )
          closed = false;
      }
    });
    if (!closed) return false;
  }
  return true;
};

const hasTruthyForwardedView = (
  p: Project,
  caller: Module,
  opening: Opening,
  field: string,
): boolean => {
  const value = jsxValue(opening, field);
  if (isNodeOfType(value, "Literal"))
    return typeof value.value === "string" && value.value.length > 0;
  const prop = isNodeOfType(value, "Identifier") ? caller.scopes.symbolFor(value) : null;
  if (!complete(caller, prop)) return false;
  const tests = readAncestorTests(opening).flatMap((condition) => {
    const alias = readConst(caller, condition);
    return alias?.initializer ? conjunction(alias.initializer) : [condition];
  });
  return tests.some((test) => {
    if (!isNodeOfType(test, "BinaryExpression") || test.operator !== "===") return false;
    const view = stripParenExpression(test.left);
    if (
      !isNodeOfType(view, "MemberExpression") ||
      !view.optional ||
      getStaticPropertyKeyName(view) === null
    )
      return false;
    const source = readConst(caller, view.object)?.initializer;
    return (
      isNodeOfType(source, "CallExpression") &&
      excludesFalsyArgument(p, caller, source, prop) &&
      isDefinedEnumMember(p, caller, test.right)
    );
  });
};

const callsBoolean = (identifier: EsTreeNode, allowDeps: boolean, m: Module): boolean => {
  const parent = identifier.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    !parent.optional &&
    parent.callee === identifier &&
    parent.arguments.length === 1 &&
    isNodeOfType(parent.arguments[0], "Literal") &&
    typeof parent.arguments[0].value === "boolean"
  )
    return true;
  return (
    allowDeps &&
    isNodeOfType(parent, "ArrayExpression") &&
    isNodeOfType(parent.parent, "CallExpression") &&
    parent.parent.arguments[1] === parent &&
    (react(m, parent.parent, "useCallback") ||
      react(m, parent.parent, "useEffect") ||
      react(m, parent.parent, "useMemo"))
  );
};

const guaranteesBooleanCallbackProp = (focal: Module, owner: EsTreeNode, name: string): boolean => {
  if (
    !isNodeOfType(owner, "FunctionDeclaration") ||
    owner.params.length !== 1 ||
    !isNodeOfType(owner.params[0], "ObjectPattern")
  )
    return false;
  const matches = owner.params[0].properties.filter(
    (entry) => isNodeOfType(entry, "Property") && getStaticPropertyKeyName(entry) === name,
  );
  if (
    matches.length !== 1 ||
    !isNodeOfType(matches[0], "Property") ||
    !isNodeOfType(matches[0].value, "Identifier")
  )
    return false;
  const sink = focal.scopes.symbolFor(matches[0].value);
  return (
    complete(focal, sink) &&
    sink.references.every(({ identifier }) => callsBoolean(identifier, true, focal))
  );
};

const hasKnownBooleanOpen = (
  caller: Module,
  opening: Opening,
  field: string,
  focal: Module,
  owner: EsTreeNode,
): boolean => {
  if (!isTruthyJsxProperty(opening, field, caller.programNode, caller.scopes)) return false;
  const value = jsxValue(opening, field);
  if (!value || isNodeOfType(value, "Literal")) return value === null || value.value === true;
  const state = readConst(caller, value);
  const decl = state?.declarationNode;
  if (
    !state ||
    !isNodeOfType(decl, "VariableDeclarator") ||
    !isNodeOfType(decl.id, "ArrayPattern") ||
    decl.id.elements.length !== 2 ||
    decl.id.elements[0] !== state.bindingIdentifier ||
    !decl.init ||
    !react(caller, decl.init, "useState") ||
    decl.init.arguments.length !== 1 ||
    !isNodeOfType(decl.init.arguments[0], "Literal") ||
    typeof decl.init.arguments[0].value !== "boolean"
  )
    return false;
  const setterNode = decl.id.elements[1];
  const setter = readConst(caller, setterNode);
  if (!setter) return false;
  return setter.references.every(({ identifier }) => {
    if (callsBoolean(identifier, false, caller)) return true;
    const wrapper = identifier.parent;
    const attr = wrapper?.parent;
    if (
      !isNodeOfType(wrapper, "JSXExpressionContainer") ||
      wrapper.expression !== identifier ||
      !isNodeOfType(attr, "JSXAttribute") ||
      attr.parent !== opening
    )
      return false;
    const prop = getJsxAttributeName(attr.name);
    return (
      prop !== null &&
      ownAttribute(opening, prop) === attr &&
      guaranteesBooleanCallbackProp(focal, owner, prop)
    );
  });
};

interface LoadingBrowserInput {
  readonly project: Project;
  readonly focal: Module;
  readonly owner: EsTreeNode;
  readonly viewProperty: string;
  readonly openProperty: string;
}

export const readLoadingAsyncOwnershipBrowserCaller = ({
  project,
  focal,
  owner,
  viewProperty,
  openProperty,
}: LoadingBrowserInput) => {
  if (
    !isNodeOfType(owner, "FunctionDeclaration") ||
    !owner.id ||
    findExportedValue(focal.programNode, "default") !== owner
  )
    return null;
  const focalSymbol = focal.scopes.rootScope.symbolsByName.get(owner.id.name) ?? null;
  if (
    !complete(focal, focalSymbol) ||
    focalSymbol.declarationNode !== owner ||
    focalSymbol.references.some(
      ({ identifier }) =>
        !isNodeOfType(identifier.parent, "ExportDefaultDeclaration") ||
        identifier.parent.declaration !== identifier,
    )
  )
    return null;
  const incoming = [...(project.index.consumerModulesByFilePath.get(focal.filePath) ?? [])];
  const [caller, alternative] = incoming.filter((m) => project.closure.reachable.has(m.filePath));
  if (!caller || alternative) return null;
  let specifier: string | undefined;
  let opaque = false;
  walkAst(caller.programNode, (node) => {
    if (project.index.resolvedSourcePathByNode.get(node) !== focal.filePath) return;
    if (
      specifier ||
      !isNodeOfType(node, "ImportExpression") ||
      !isNodeOfType(node.source, "Literal") ||
      typeof node.source.value !== "string"
    )
      opaque = true;
    else specifier = node.source.value;
  });
  if (
    !specifier ||
    opaque ||
    inspectConsumerModule(caller.programNode, caller.scopes, {
      route: "lazy",
      tag: "default",
      property: openProperty,
      specifier,
      checkOpening: (opening) =>
        hasKnownBooleanOpen(caller, opening, openProperty, focal, owner) &&
        hasTruthyForwardedView(project, caller, opening, viewProperty),
    }) !== 1
  )
    return null;
  return {
    caller,
    directNamedTestCandidates: incoming.filter((m) => !project.closure.reachable.has(m.filePath)),
  };
};
