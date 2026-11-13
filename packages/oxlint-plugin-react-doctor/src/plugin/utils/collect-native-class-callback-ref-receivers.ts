import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { resolveCrossFileExport } from "./resolve-cross-file-export.js";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";
import { isFunctionLike } from "./is-function-like.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getImportedName } from "./get-imported-name.js";
import { isImportedFromReact, isReactNamespaceImport } from "./is-react-api-call.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPropertyNamePosition } from "./is-property-name-position.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

const DYNAMIC_REF_CAPABILITIES = new Set([
  "eval",
  "Function",
  "constructor",
  "prototype",
  "__proto__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__defineGetter__",
  "__defineSetter__",
]);
const JSX_RUNTIME_PROVIDER_SOURCES = new Set(["react/jsx-runtime", "react/jsx-dev-runtime"]);
const EXECUTION_NAMESPACE_NAMES = new Set(["window", "globalThis", "global", "self"]);

const isDirectThisMember = (node: EsTreeNode, name: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(stripParenExpression(node.object), "ThisExpression") &&
  getStaticPropertyName(node) === name;

const isStoredMemberWrite = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  if (
    isNodeOfType(root.parent, "MemberExpression") &&
    (root.parent.object === root || (root.parent.computed && root.parent.property === root))
  )
    return false;
  return isWithinAssignmentTarget(root);
};

const NATIVE_SCROLL_DATA_PROPERTIES = new Set(["scrollTop", "scrollLeft"]);

const resolveLiteralScrollPropertyRecord = (
  reference: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(reference, "Identifier") || !context.filename) return null;
  const symbol = context.scopes.symbolFor(reference);
  const specifier = symbol?.declarationNode;
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type"
  )
    return null;
  const declaration = specifier.parent;
  const importedName = getImportedName(specifier);
  if (
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    !importedName ||
    typeof declaration.source.value !== "string" ||
    !declaration.source.value.startsWith(".")
  )
    return null;
  const resolved = resolveCrossFileExport(context.filename, declaration.source.value, importedName);
  if (
    !resolved ||
    resolved.filePath !== resolveRelativeImportPath(context.filename, declaration.source.value) ||
    !isNodeOfType(resolved.node, "ObjectExpression") ||
    !isNodeOfType(resolved.programNode, "Program")
  )
    return null;
  const declarator = resolved.node.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== resolved.node ||
    !isNodeOfType(declarator.id, "Identifier") ||
    declarator.id.name !== importedName ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(declarator.parent.parent, "ExportNamedDeclaration")
  )
    return null;
  const enumValues = new Map<string, ReadonlyMap<string, string>>();
  const declaredNames = new Set<string>();
  for (const statement of resolved.programNode.body) {
    if (
      !isNodeOfType(statement, "ExportNamedDeclaration") ||
      !statement.declaration ||
      statement.source
    )
      return null;
    const exported = statement.declaration;
    if (isNodeOfType(exported, "TSEnumDeclaration")) {
      if (
        exported.declare ||
        !isNodeOfType(exported.id, "Identifier") ||
        declaredNames.has(exported.id.name)
      )
        return null;
      declaredNames.add(exported.id.name);
      const values = new Map<string, string>();
      for (const member of exported.body?.members ?? exported.members) {
        const name = isNodeOfType(member.id, "Identifier")
          ? member.id.name
          : isNodeOfType(member.id, "Literal") && typeof member.id.value === "string"
            ? member.id.value
            : null;
        if (
          !name ||
          !isNodeOfType(member.initializer, "Literal") ||
          typeof member.initializer.value !== "string" ||
          values.has(name)
        )
          return null;
        values.set(name, member.initializer.value);
      }
      enumValues.set(exported.id.name, values);
    } else if (!isNodeOfType(exported, "VariableDeclaration") || exported.kind !== "const")
      return null;
  }
  for (const statement of resolved.programNode.body) {
    if (
      !isNodeOfType(statement, "ExportNamedDeclaration") ||
      !isNodeOfType(statement.declaration, "VariableDeclaration")
    )
      continue;
    for (const variable of statement.declaration.declarations) {
      if (
        !isNodeOfType(variable.id, "Identifier") ||
        declaredNames.has(variable.id.name) ||
        !isNodeOfType(variable.init, "ObjectExpression")
      )
        return null;
      declaredNames.add(variable.id.name);
      for (const property of variable.init.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.method ||
          !isNodeOfType(property.value, "Literal") ||
          typeof property.value.value !== "string"
        )
          return null;
        let key = getStaticPropertyKeyName(property, { allowComputedString: true });
        if (key === null && property.computed && isNodeOfType(property.key, "MemberExpression")) {
          const enumObject = stripParenExpression(property.key.object);
          const enumMember = getStaticPropertyName(property.key);
          key =
            isNodeOfType(enumObject, "Identifier") && enumMember
              ? (enumValues.get(enumObject.name)?.get(enumMember) ?? null)
              : null;
        }
        if (!key || ["__proto__", "constructor", "prototype"].includes(key)) return null;
        if (variable === declarator && !NATIVE_SCROLL_DATA_PROPERTIES.has(property.value.value))
          return null;
      }
      if (variable === declarator && variable.init.properties.length === 0) return null;
    }
  }
  const foreignScopes = analyzeScopes(resolved.programNode);
  const foreignSymbol = foreignScopes.symbolFor(declarator.id);
  if (!foreignSymbol || foreignSymbol.kind !== "const" || foreignSymbol.references.length !== 0)
    return null;
  if (
    !symbol.references.every((usage) => {
      const root = findTransparentExpressionRoot(usage.identifier);
      const lookup = root.parent;
      return (
        usage.flag === "read" &&
        isNodeOfType(lookup, "MemberExpression") &&
        lookup.object === root &&
        lookup.computed &&
        !isStoredMemberWrite(lookup)
      );
    })
  )
    return null;
  return symbol;
};

export const collectNativeClassCallbackRefReceivers = (
  classBody: EsTreeNode,
  context: RuleContext,
): ReadonlyMap<EsTreeNode, string> => {
  const emptyReceivers = new Map<EsTreeNode, string>();
  const classNode = classBody.parent;
  if (
    !isNodeOfType(classBody, "ClassBody") ||
    !classNode ||
    !isProvenReactClassComponent(classNode, context.scopes)
  )
    return emptyReceivers;
  if (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression"))
    return emptyReceivers;
  if (!classNode.superClass) return emptyReceivers;
  const superclass = stripParenExpression(classNode.superClass);
  if (isNodeOfType(superclass, "Identifier")) {
    const superclassSymbol = context.scopes.symbolFor(superclass);
    if (
      !superclassSymbol ||
      !isImportedFromReact(superclassSymbol) ||
      !["Component", "PureComponent"].includes(
        getImportedName(superclassSymbol.declarationNode) ?? "",
      )
    )
      return emptyReceivers;
  } else {
    if (
      !isNodeOfType(superclass, "MemberExpression") ||
      !isReactNamespaceImport(stripParenExpression(superclass.object), context.scopes)
    )
      return emptyReceivers;
  }
  const superclassReference = isNodeOfType(superclass, "MemberExpression")
    ? stripParenExpression(superclass.object)
    : superclass;
  const superclassSymbol = context.scopes.symbolFor(superclassReference);
  const superclassImport = superclassSymbol?.declarationNode;
  const superclassDeclaration = superclassImport?.parent;
  if (
    !superclassSymbol ||
    superclassSymbol.kind !== "import" ||
    !isNodeOfType(superclassDeclaration, "ImportDeclaration") ||
    superclassDeclaration.importKind === "type" ||
    (isNodeOfType(superclassImport, "ImportSpecifier") && superclassImport.importKind === "type")
  )
    return emptyReceivers;
  const sourceText = context.sourceCode?.getText?.() ?? "";
  if (
    /@jsx(?:ImportSource|Factory|Frag)?\b/.test(sourceText) ||
    context.settings?.["jsxPragma"] ||
    context.settings?.["jsxImportSource"]
  )
    return emptyReceivers;
  const members = classBody.body;
  const memberNames = members.map((member) =>
    getStaticPropertyKeyName(member, { allowComputedString: true }),
  );
  if (
    memberNames.some((name) => !name) ||
    new Set(memberNames).size !== memberNames.length ||
    members.some((member) => "decorators" in member && Boolean(member.decorators?.length))
  )
    return emptyReceivers;
  const renderMember = members.find((member) => getStaticPropertyKeyName(member) === "render");
  if (
    !isNodeOfType(renderMember, "MethodDefinition") ||
    renderMember.static ||
    renderMember.kind !== "method" ||
    renderMember.value.async ||
    renderMember.value.generator
  )
    return emptyReceivers;
  const render = renderMember.value;
  const returnStatements: EsTreeNode[] = [];
  walkOwnFunctionScope(render, (node) => {
    if (isNodeOfType(node, "ReturnStatement")) returnStatements.push(node);
  });
  const returned = returnStatements[0];
  if (
    returnStatements.length !== 1 ||
    !isNodeOfType(returned, "ReturnStatement") ||
    returned.parent !== render.body ||
    !returned.argument
  )
    return emptyReceivers;
  const rootElement = stripParenExpression(returned.argument);
  if (
    !isNodeOfType(rootElement, "JSXElement") ||
    !isNodeOfType(rootElement.openingElement.name, "JSXIdentifier") ||
    !/^[a-z]+$/.test(rootElement.openingElement.name.name)
  )
    return emptyReceivers;
  const opening = rootElement.openingElement;
  const refAttributes = opening.attributes.filter(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "ref",
  );
  const refAttribute = refAttributes[0];
  if (
    refAttributes.length !== 1 ||
    !isNodeOfType(refAttribute, "JSXAttribute") ||
    !isNodeOfType(refAttribute.value, "JSXExpressionContainer")
  )
    return emptyReceivers;
  const callbackReference = stripParenExpression(refAttribute.value.expression);
  if (
    !isNodeOfType(callbackReference, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(callbackReference.object), "ThisExpression")
  )
    return emptyReceivers;
  const callbackName = getStaticPropertyName(callbackReference);
  const callbackMember = members.find(
    (member) => getStaticPropertyKeyName(member) === callbackName,
  );
  if (
    !callbackName ||
    !isNodeOfType(callbackMember, "PropertyDefinition") ||
    callbackMember.static ||
    !isNodeOfType(callbackMember.value, "ArrowFunctionExpression") ||
    callbackMember.value.async ||
    callbackMember.value.params.length !== 1
  )
    return emptyReceivers;
  const callback = callbackMember.value;
  const parameter = callback.params[0];
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1
  )
    return emptyReceivers;
  const statement = callback.body.body[0];
  if (!isNodeOfType(statement, "ExpressionStatement")) return emptyReceivers;
  const assignment = stripParenExpression(statement.expression);
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(assignment.left.object), "ThisExpression")
  )
    return emptyReceivers;
  const fieldName = getStaticPropertyName(assignment.left);
  const value = stripParenExpression(assignment.right);
  const parameterSymbol = context.scopes.symbolFor(parameter);
  if (
    !fieldName ||
    fieldName === callbackName ||
    fieldName === "props" ||
    fieldName === "state" ||
    !parameterSymbol ||
    !isNodeOfType(value, "Identifier") ||
    context.scopes.symbolFor(value) !== parameterSymbol ||
    parameterSymbol.references.length !== 1 ||
    parameterSymbol.references[0]?.identifier !== value ||
    parameterSymbol.references[0]?.flag !== "read"
  )
    return emptyReceivers;
  const field = members.find((member) => getStaticPropertyKeyName(member) === fieldName);
  if (!isNodeOfType(field, "PropertyDefinition") || field.static) return emptyReceivers;
  const initialValue = field.value ? stripParenExpression(field.value) : null;
  if (initialValue && (!isNodeOfType(initialValue, "Literal") || initialValue.value !== null))
    return emptyReceivers;
  const cleanupMember = members.find(
    (member) => getStaticPropertyKeyName(member) === "componentWillUnmount",
  );
  if (
    !isNodeOfType(cleanupMember, "MethodDefinition") ||
    cleanupMember.static ||
    cleanupMember.kind !== "method" ||
    cleanupMember.value.async ||
    cleanupMember.value.generator ||
    cleanupMember.value.params.length !== 0 ||
    !cleanupMember.value.body ||
    cleanupMember.value.body.body.length !== 1
  )
    return emptyReceivers;
  const cleanupStatement = cleanupMember.value.body.body[0];
  if (!isNodeOfType(cleanupStatement, "ExpressionStatement")) return emptyReceivers;
  const cleanupCall = stripParenExpression(cleanupStatement.expression);
  if (!isNodeOfType(cleanupCall, "CallExpression")) return emptyReceivers;
  const cleanupCallee = stripParenExpression(cleanupCall.callee);
  if (
    !isNodeOfType(cleanupCallee, "MemberExpression") ||
    getStaticPropertyName(cleanupCallee) !== "removeEventListener" ||
    !isDirectThisMember(stripParenExpression(cleanupCallee.object), fieldName)
  )
    return emptyReceivers;
  const handlerArgument = cleanupCall.arguments[1];
  if (!handlerArgument || isNodeOfType(handlerArgument, "SpreadElement")) return emptyReceivers;
  const handlerReference = stripParenExpression(handlerArgument);
  if (
    !isNodeOfType(handlerReference, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(handlerReference.object), "ThisExpression")
  )
    return emptyReceivers;
  const handlerName = getStaticPropertyName(handlerReference);
  const handlerMember = members.find((member) => getStaticPropertyKeyName(member) === handlerName);
  if (
    !handlerName ||
    !isNodeOfType(handlerMember, "PropertyDefinition") ||
    handlerMember.static ||
    !isNodeOfType(handlerMember.value, "ArrowFunctionExpression")
  )
    return emptyReceivers;
  const restReferences = new Set<EsTreeNode>();
  for (const attribute of opening.attributes) {
    if (isNodeOfType(attribute, "JSXAttribute")) {
      if (
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        ["key", "is"].includes(attribute.name.name)
      )
        return emptyReceivers;
      continue;
    }
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) return emptyReceivers;
    const rest = stripParenExpression(attribute.argument);
    const symbol = isNodeOfType(rest, "Identifier") ? context.scopes.symbolFor(rest) : null;
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "ObjectPattern") ||
      !declaration.init ||
      !isDirectThisMember(stripParenExpression(declaration.init), "props") ||
      declaration.range[0] >= returned.range[0] ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.parent !== render.body ||
      !declaration.id.properties.some(
        (property) =>
          isNodeOfType(property, "RestElement") && property.argument === symbol.bindingIdentifier,
      ) ||
      declaration.id.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          (!getStaticPropertyKeyName(property, { allowComputedString: true }) ||
            ["ref", "key", "is"].includes(
              getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
            )),
      ) ||
      symbol.references.length !== 1 ||
      symbol.references[0]?.identifier !== rest ||
      symbol.references[0]?.flag !== "read"
    )
      return emptyReceivers;
    restReferences.add(rest);
  }
  const defaultProps = members.find(
    (member) => getStaticPropertyKeyName(member) === "defaultProps",
  );
  if (defaultProps) {
    if (
      !isNodeOfType(defaultProps, "PropertyDefinition") ||
      !defaultProps.static ||
      !isNodeOfType(defaultProps.value, "ObjectExpression") ||
      defaultProps.value.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.method ||
          !getStaticPropertyKeyName(property, { allowComputedString: true }) ||
          ["ref", "key", "is", "__proto__"].includes(
            getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
          ),
      )
    )
      return emptyReceivers;
  }
  const propsDefaultNodes = new Set<EsTreeNode>();
  const propsDefaultSymbols = new Set<SymbolDescriptor>();
  walkAst(classBody, (candidate) => {
    if (
      !isNodeOfType(candidate, "AssignmentPattern") ||
      !isNodeOfType(candidate.left, "Identifier") ||
      !isDirectThisMember(stripParenExpression(candidate.right), "props")
    )
      return;
    const owner = candidate.parent;
    if (
      !isFunctionLike(owner) ||
      !owner.params.some((parameter) => parameter === candidate) ||
      owner.async ||
      owner.generator
    )
      return;
    const symbol = context.scopes.symbolFor(candidate.left);
    if (
      !symbol ||
      !symbol.references.every((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        const member = root.parent;
        if (!isNodeOfType(member, "MemberExpression")) return false;
        let terminal = findTransparentExpressionRoot(member);
        while (
          isNodeOfType(terminal.parent, "MemberExpression") &&
          terminal.parent.object === terminal
        ) {
          terminal = findTransparentExpressionRoot(terminal.parent);
        }
        const parent = terminal.parent;
        return (
          reference.flag === "read" &&
          member.object === root &&
          getStaticPropertyName(member) !== null &&
          !isStoredMemberWrite(terminal) &&
          !(
            (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
            parent.callee === terminal
          ) &&
          !(isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === terminal)
        );
      })
    )
      return;
    propsDefaultNodes.add(stripParenExpression(candidate.right));
    propsDefaultSymbols.add(symbol);
  });
  let program: EsTreeNode = classNode;
  while (program.parent) program = program.parent;
  const disjointCacheNames = new Set(
    members.flatMap((member) => {
      const name = getStaticPropertyKeyName(member);
      return name &&
        name !== fieldName &&
        name !== "props" &&
        name !== "state" &&
        isNodeOfType(member, "PropertyDefinition") &&
        !member.static &&
        isNodeOfType(member.value, "ObjectExpression") &&
        member.value.properties.length === 0
        ? [name]
        : [];
    }),
  );
  walkAst(program, (candidate) => {
    if (isTypeScriptTypePosition(candidate)) return false;
    if (!isNodeOfType(candidate, "MemberExpression")) return;
    const name = getStaticPropertyName(candidate);
    if (!name || !disjointCacheNames.has(name)) return;
    if (!isDirectThisMember(candidate, name)) {
      if (isStoredMemberWrite(candidate)) disjointCacheNames.delete(name);
      return;
    }
    const root = findTransparentExpressionRoot(candidate);
    const parent = root.parent;
    if (isStoredMemberWrite(candidate)) {
      const replacement = isNodeOfType(parent, "AssignmentExpression")
        ? stripParenExpression(parent.right)
        : null;
      if (
        !isNodeOfType(parent, "AssignmentExpression") ||
        parent.left !== root ||
        parent.operator !== "=" ||
        !isNodeOfType(replacement, "ObjectExpression") ||
        replacement.properties.length !== 0
      )
        disjointCacheNames.delete(name);
    } else if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root)
      disjointCacheNames.delete(name);
  });
  const reactProviderSymbols = new Set<SymbolDescriptor>();
  if (isNodeOfType(program, "Program"))
    for (const statement of program.body) {
      if (!isNodeOfType(statement, "ImportDeclaration") || statement.importKind === "type")
        continue;
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const isJsxRuntimeNamespace =
          JSX_RUNTIME_PROVIDER_SOURCES.has(String(statement.source.value)) &&
          (isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            (isNodeOfType(specifier, "ImportSpecifier") &&
              getImportedName(specifier) === "default"));
        if (!isJsxRuntimeNamespace && !isReactNamespaceImport(specifier.local, context.scopes))
          continue;
        const providerSymbol = context.scopes.symbolFor(specifier.local);
        if (providerSymbol) reactProviderSymbols.add(providerSymbol);
      }
    }
  const classicProvider = context.scopes.rootScope.symbols.find(
    (symbol) =>
      symbol.name === "React" && symbol.kind !== "ts-interface" && symbol.kind !== "ts-type-alias",
  );
  if (classicProvider && !reactProviderSymbols.has(classicProvider)) return emptyReceivers;
  let closed = true;
  const scrollPropertyRecords = new Set<SymbolDescriptor>();
  const receivers = new Map<EsTreeNode, string>();
  const restSymbols = new Set(
    [...restReferences].map((reference) => context.scopes.symbolFor(reference)),
  );
  walkAst(program, (node) => {
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (
      [
        "TSEnumDeclaration",
        "TSModuleDeclaration",
        "TSParameterProperty",
        "WithStatement",
        "Decorator",
      ].includes(node.type)
    ) {
      closed = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      if (
        isNodeOfType(node.parent, "ImportSpecifier") ||
        isNodeOfType(node.parent, "ImportNamespaceSpecifier") ||
        isNodeOfType(node.parent, "ImportDefaultSpecifier")
      )
        return;
      for (const record of scrollPropertyRecords) {
        if (node.name !== record.name || node === record.bindingIdentifier) continue;
        if (
          !context.scopes.referenceFor(node) &&
          !isPropertyNamePosition(node) &&
          context.scopes.symbolFor(node)?.bindingIdentifier !== node
        ) {
          closed = false;
          return;
        }
      }
      if (isPropertyNamePosition(node)) return;
      if (node.name === "React" && !classicProvider) {
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        const reference = context.scopes.referenceFor(node);
        if (
          isWithinAssignmentTarget(root) ||
          reference?.flag !== "read" ||
          (!(isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") &&
            !(
              isNodeOfType(parent, "MemberExpression") &&
              parent.object === root &&
              getStaticPropertyName(parent) !== null
            ))
        ) {
          closed = false;
          return;
        }
      }
      for (const provider of reactProviderSymbols) {
        if (
          node.name !== provider.name ||
          node === provider.bindingIdentifier ||
          context.scopes.symbolFor(node)?.bindingIdentifier === node
        )
          continue;
        const reference = context.scopes.referenceFor(node);
        if (!reference) {
          closed = false;
          return;
        }
        if (reference.resolvedSymbol !== provider) continue;
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        if (
          reference.flag !== "read" ||
          (!(isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") &&
            !(
              isNodeOfType(parent, "MemberExpression") &&
              parent.object === root &&
              getStaticPropertyName(parent) !== null
            ))
        ) {
          closed = false;
          return;
        }
      }
      if (
        DYNAMIC_REF_CAPABILITIES.has(node.name) &&
        context.scopes.symbolFor(node)?.bindingIdentifier !== node
      ) {
        closed = false;
        return;
      }
      if (
        (EXECUTION_NAMESPACE_NAMES.has(node.name) || ["Object", "Reflect"].includes(node.name)) &&
        !isNodeOfType(findTransparentExpressionRoot(node).parent, "MemberExpression") &&
        context.scopes.symbolFor(node)?.bindingIdentifier !== node
      ) {
        closed = false;
        return;
      }
      for (const symbol of [...restSymbols, ...propsDefaultSymbols]) {
        if (
          !symbol ||
          node.name !== symbol.name ||
          node === symbol.bindingIdentifier ||
          context.scopes.symbolFor(node)?.bindingIdentifier === node ||
          restReferences.has(node) ||
          (propsDefaultSymbols.has(symbol) &&
            symbol.references.some((reference) => reference.identifier === node))
        )
          continue;
        if (!context.scopes.referenceFor(node) || context.scopes.symbolFor(node) === symbol) {
          closed = false;
          return;
        }
      }
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const key = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        !key ||
        DYNAMIC_REF_CAPABILITIES.has(key) ||
        [fieldName, callbackName, handlerName, "defaultProps", "props"].includes(key)
      ) {
        closed = false;
        return;
      }
    }
    if (isNodeOfType(node, "ThisExpression")) {
      const root = findTransparentExpressionRoot(node);
      if (
        !isNodeOfType(root.parent, "MemberExpression") ||
        root.parent.object !== root ||
        getStaticPropertyName(root.parent) === null
      ) {
        closed = false;
        return;
      }
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const name = getStaticPropertyName(node);
    const receiver = stripParenExpression(node.object);
    let capabilityRoot = receiver;
    while (isNodeOfType(capabilityRoot, "MemberExpression"))
      capabilityRoot = stripParenExpression(capabilityRoot.object);
    if (
      name === null &&
      isNodeOfType(capabilityRoot, "Identifier") &&
      EXECUTION_NAMESPACE_NAMES.has(capabilityRoot.name)
    ) {
      closed = false;
      return;
    }
    if (
      name &&
      (["Object", "Reflect"].includes(name) ||
        DYNAMIC_REF_CAPABILITIES.has(name) ||
        ((name === "assign" || name === "set" || name === "get") &&
          isNodeOfType(receiver, "Identifier") &&
          ["Object", "Reflect"].includes(receiver.name)))
    ) {
      closed = false;
      return;
    }
    if (
      name &&
      EXECUTION_NAMESPACE_NAMES.has(name) &&
      isNodeOfType(capabilityRoot, "Identifier") &&
      EXECUTION_NAMESPACE_NAMES.has(capabilityRoot.name)
    ) {
      const memberRoot = findTransparentExpressionRoot(node);
      if (
        !isNodeOfType(memberRoot.parent, "MemberExpression") ||
        memberRoot.parent.object !== memberRoot ||
        getStaticPropertyName(memberRoot.parent) === null
      ) {
        closed = false;
        return;
      }
    }
    const reactProvider = isNodeOfType(capabilityRoot, "Identifier")
      ? context.scopes.symbolFor(capabilityRoot)
      : null;
    if (reactProvider && reactProviderSymbols.has(reactProvider) && isStoredMemberWrite(node)) {
      closed = false;
      return;
    }
    let storedReceiver = receiver;
    while (
      isNodeOfType(storedReceiver, "MemberExpression") &&
      !isDirectThisMember(storedReceiver, "props")
    )
      storedReceiver = stripParenExpression(storedReceiver.object);
    if (isStoredMemberWrite(node) && isDirectThisMember(storedReceiver, "props")) {
      closed = false;
      return;
    }
    let isProvenScrollDataWrite = false;
    if (
      name === null &&
      isStoredMemberWrite(node) &&
      isDirectThisMember(receiver, fieldName) &&
      node.computed
    ) {
      const lookup = stripParenExpression(node.property);
      if (isNodeOfType(lookup, "MemberExpression") && lookup.computed) {
        const record = resolveLiteralScrollPropertyRecord(
          stripParenExpression(lookup.object),
          context,
        );
        if (record) {
          scrollPropertyRecords.add(record);
          isProvenScrollDataWrite = true;
        }
      }
    }
    const isDisjointCacheWrite =
      isNodeOfType(receiver, "MemberExpression") &&
      isNodeOfType(stripParenExpression(receiver.object), "ThisExpression") &&
      disjointCacheNames.has(getStaticPropertyName(receiver) ?? "");
    if (
      name === "defaultProps" ||
      (isStoredMemberWrite(node) &&
        ((name === null && !isProvenScrollDataWrite && !isDisjointCacheWrite) ||
          [
            fieldName,
            callbackName,
            handlerName,
            "props",
            "render",
            "addEventListener",
            "removeEventListener",
            "createElement",
            "Component",
            "PureComponent",
            "jsx",
            "jsxs",
            "jsxDEV",
            "React",
          ].includes(name ?? "")) &&
        node !== assignment.left)
    ) {
      closed = false;
      return;
    }
    if (isDirectThisMember(node, callbackName) && node !== callbackReference) {
      closed = false;
      return;
    }
    if (isDirectThisMember(node, "props")) {
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (
        !(isNodeOfType(parent, "MemberExpression") && parent.object === root) &&
        !(
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "ObjectPattern")
        ) &&
        !propsDefaultNodes.has(node)
      ) {
        closed = false;
        return;
      }
    }
    if (!isDirectThisMember(node, fieldName) || node === assignment.left) return;
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (
      !(isNodeOfType(parent, "MemberExpression") && parent.object === root) &&
      !(
        isNodeOfType(parent, "BinaryExpression") &&
        ["===", "!==", "==", "!="].includes(parent.operator)
      )
    ) {
      closed = false;
      return;
    }
    if (findEnclosingClass(node) !== classNode) return;
    let lexicalOwner = node.parent;
    while (lexicalOwner && lexicalOwner !== classBody) {
      if (
        isFunctionLike(lexicalOwner) &&
        !isNodeOfType(lexicalOwner, "ArrowFunctionExpression") &&
        lexicalOwner.parent?.parent !== classBody
      )
        return;
      lexicalOwner = lexicalOwner.parent;
    }
    receivers.set(node, `native-callback-ref:${classBody.range[0]}:${fieldName}`);
  });
  if (closed && scrollPropertyRecords.size > 0)
    walkAst(program, (node) => {
      if (!closed || isTypeScriptTypePosition(node)) return false;
      if (
        !isNodeOfType(node, "Identifier") ||
        isPropertyNamePosition(node) ||
        isNodeOfType(node.parent, "ImportSpecifier") ||
        isNodeOfType(node.parent, "ImportNamespaceSpecifier") ||
        isNodeOfType(node.parent, "ImportDefaultSpecifier")
      )
        return;
      for (const record of scrollPropertyRecords) {
        if (
          node.name === record.name &&
          node !== record.bindingIdentifier &&
          !context.scopes.referenceFor(node) &&
          context.scopes.symbolFor(node)?.bindingIdentifier !== node
        ) {
          closed = false;
          return;
        }
      }
    });
  return closed ? receivers : emptyReceivers;
};
