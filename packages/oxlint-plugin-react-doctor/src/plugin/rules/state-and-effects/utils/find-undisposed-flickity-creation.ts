import { parseSync } from "oxc-parser";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFiniteStaticStringValues } from "../../../utils/get-finite-static-string-values.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isProvenReactClassComponent } from "../../../utils/is-proven-react-class-component.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import {
  FLICKITY_JSX_DIRECTIVE_PATTERN,
  FLICKITY_POSSIBLE_JSX_DIRECTIVE_PATTERN,
} from "./constants.js";
import type { ScopeDescriptor } from "../../../semantic/scope-analysis.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";

const UNSUPPORTED_PROVIDER_GLOBALS = new Set([
  "eval",
  "Function",
  "Proxy",
  "Object",
  "Reflect",
  "globalThis",
  "global",
  "require",
]);
const REFLECTION_PROPERTIES = new Set([
  ...UNSUPPORTED_PROVIDER_GLOBALS,
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "destroy",
]);
const NON_DISPOSING_INSTANCE_METHODS = new Set(["activate", "deactivate", "reloadCells"]);
const providerAdmissionByScope = new WeakMap<RuleContext["scopes"], boolean>();
const constructorAdmissionBySymbol = new WeakMap<SymbolDescriptor, boolean>();
const propBindingBySymbol = new WeakMap<SymbolDescriptor, EsTreeNodeOfType<"Property"> | null>();
const absentPropDefaultByClass = new WeakMap<EsTreeNodeOfType<"ClassBody">, Map<string, boolean>>();
const literalOptionsDefaultByClass = new WeakMap<
  EsTreeNodeOfType<"ClassBody">,
  Map<string, boolean>
>();
const nativeElementDefaultByClass = new WeakMap<
  EsTreeNodeOfType<"ClassBody">,
  Map<string, boolean>
>();
const imageObserverAdmissionBySymbol = new WeakMap<SymbolDescriptor, boolean>();
const imageCallbackAdmissionBySymbol = new WeakMap<SymbolDescriptor, boolean>();

interface FlickityJsxSourceFacts {
  program: EsTreeNode;
  sourceText: string;
  supported: boolean;
  factory: string | null;
  usesClassicRuntime: boolean;
}

const jsxSourceFactsByScopes = new WeakMap<RuleContext["scopes"], FlickityJsxSourceFacts>();

const hasNativeProviderReference = (
  node: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  if (context.scopes.isGlobalReference(node)) return true;
  const symbol = context.scopes.symbolFor(node);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    !hasRuntimeValueBinding(symbol),
  );
};

const hasNativeJsxFactory = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const sourceCode = context.sourceCode;
  if (!sourceCode?.getText) return false;
  let sourceText: string;
  try {
    sourceText = sourceCode.getText();
  } catch {
    return false;
  }
  if (typeof sourceText !== "string") return false;
  const program = findProgramRoot(opening);
  if (!program || context.scopes.rootScope.node !== program) return false;
  let facts = jsxSourceFactsByScopes.get(context.scopes);
  if (!facts || facts.program !== program || facts.sourceText !== sourceText) {
    facts = { program, sourceText, supported: true, factory: null, usesClassicRuntime: false };
    if (FLICKITY_POSSIBLE_JSX_DIRECTIVE_PATTERN.test(sourceText)) {
      try {
        const parsed = parseSync("flickity-native-ref.tsx", sourceText, {
          astType: "ts",
          lang: "tsx",
        });
        if (parsed.errors.some((error) => error.severity === "Error")) facts.supported = false;
        for (const comment of parsed.comments) {
          for (const directive of comment.value.matchAll(FLICKITY_JSX_DIRECTIVE_PATTERN)) {
            const [, kind, provider] = directive;
            if (kind === "jsxImportSource" && provider !== "react") facts.supported = false;
            if (kind === "jsx") {
              if (facts.factory && facts.factory !== provider) facts.supported = false;
              facts.factory = provider ?? null;
            }
            if (kind === "jsxRuntime" && provider === "classic") facts.usesClassicRuntime = true;
          }
        }
      } catch {
        facts.supported = false;
      }
    }
    jsxSourceFactsByScopes.set(context.scopes, facts);
  }
  if (!facts.supported) return false;
  const factory = facts.factory ?? (facts.usesClassicRuntime ? "React.createElement" : null);
  if (!factory) return true;
  const factoryParts = factory.split(".");
  if (factoryParts.length > 2 || (factoryParts.length === 2 && factoryParts[1] !== "createElement"))
    return false;
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(opening);
  while (scope) {
    const symbols = scope.symbols.filter(
      (symbol) => symbol.name === factoryParts[0] && !isErasedTypeScriptBinding(symbol),
    );
    if (symbols.length > 0) {
      const symbol = symbols[0];
      if (symbols.length !== 1 || !symbol) return false;
      const imported = resolveImportedApiReference(symbol.bindingIdentifier, context.scopes);
      return Boolean(
        imported &&
        imported.source === "react" &&
        (factoryParts.length === 1
          ? imported.importedName === "createElement"
          : imported.isNamespace || imported.importedName === "default"),
      );
    }
    scope = scope.parent;
  }
  return false;
};

const isDirectWrite = (node: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  return Boolean(
    (isNodeOfType(parent, "AssignmentExpression") && parent.left === expression) ||
    (isNodeOfType(parent, "UpdateExpression") && parent.argument === expression) ||
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "delete" &&
      parent.argument === expression),
  );
};

const hasAdmittedProvider = (node: EsTreeNode, context: RuleContext): boolean => {
  const cached = providerAdmissionByScope.get(context.scopes);
  if (cached !== undefined) return cached;
  const program = findProgramRoot(node);
  const admitted =
    Boolean(program) &&
    !someAst(program ?? node, (candidate) => {
      if (isNodeOfType(candidate, "WithStatement") || isNodeOfType(candidate, "Decorator"))
        return true;
      if (
        (isNodeOfType(candidate, "Property") ||
          isNodeOfType(candidate, "MethodDefinition") ||
          isNodeOfType(candidate, "PropertyDefinition")) &&
        (getStaticPropertyKeyName(candidate, { allowComputedString: true }) === "destroy" ||
          (candidate.computed &&
            getFiniteStaticStringValues(candidate.key, context).has("destroy")))
      )
        return true;
      if (isNodeOfType(candidate, "ImportDeclaration")) {
        if (
          candidate.source.value === "react" &&
          candidate.specifiers.some((specifier) => {
            const symbol = context.scopes.symbolFor(specifier.local);
            return (
              symbol &&
              getValueImportSource(symbol) === null &&
              symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
            );
          })
        )
          return true;
        return (
          typeof candidate.source.value === "string" &&
          /^(?:node:)?(?:vm|module)(?:\/|$)/.test(candidate.source.value)
        );
      }
      if (isNodeOfType(candidate, "ImportExpression")) {
        return !isNodeOfType(candidate.source, "Literal") || candidate.source.value !== "flickity";
      }
      if (isNodeOfType(candidate, "Identifier")) {
        return (
          !isTypeScriptTypePosition(candidate) &&
          Boolean(context.scopes.referenceFor(candidate)) &&
          hasNativeProviderReference(candidate, context) &&
          UNSUPPORTED_PROVIDER_GLOBALS.has(candidate.name)
        );
      }
      if (isNodeOfType(candidate, "MemberExpression")) {
        if (isDirectWrite(candidate)) {
          let receiver = stripParenExpression(candidate.object);
          while (isNodeOfType(receiver, "MemberExpression"))
            receiver = stripParenExpression(receiver.object);
          if (!isNodeOfType(receiver, "ThisExpression")) return true;
        }
        const directName = getStaticPropertyName(candidate);
        return (
          Boolean(directName && REFLECTION_PROPERTIES.has(directName)) ||
          (candidate.computed &&
            [...getFiniteStaticStringValues(candidate.property, context)].some((propertyName) =>
              REFLECTION_PROPERTIES.has(propertyName),
            ))
        );
      }
      return (
        isNodeOfType(candidate, "Property") &&
        isNodeOfType(candidate.parent, "ObjectPattern") &&
        (Boolean(
          getStaticPropertyKeyName(candidate) &&
          REFLECTION_PROPERTIES.has(getStaticPropertyKeyName(candidate) ?? ""),
        ) ||
          (candidate.computed &&
            [...getFiniteStaticStringValues(candidate.key, context)].some((propertyName) =>
              REFLECTION_PROPERTIES.has(propertyName),
            )))
      );
    });
  providerAdmissionByScope.set(context.scopes, admitted);
  return admitted;
};

const isFlickityConstructor = (node: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(node);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol) return false;
  const cached = constructorAdmissionBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  let admitted =
    getValueImportSource(symbol) === "flickity" &&
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier");
  if (symbol.kind === "const" && symbol.initializer) {
    const initializer = stripParenExpression(symbol.initializer);
    const awaitedModule =
      isNodeOfType(initializer, "MemberExpression") &&
      getStaticPropertyName(initializer) === "default"
        ? stripParenExpression(initializer.object)
        : null;
    const importedModule = isNodeOfType(awaitedModule, "AwaitExpression")
      ? stripParenExpression(awaitedModule.argument)
      : null;
    admitted =
      isNodeOfType(importedModule, "ImportExpression") &&
      isNodeOfType(importedModule.source, "Literal") &&
      importedModule.source.value === "flickity";
  }
  admitted =
    admitted &&
    symbol.references.every((reference) => {
      if (
        reference.identifier === symbol.bindingIdentifier ||
        isTypeScriptTypePosition(reference.identifier)
      )
        return true;
      const expression = findTransparentExpressionRoot(reference.identifier);
      return (
        reference.flag === "read" &&
        isNodeOfType(expression.parent, "NewExpression") &&
        expression.parent.callee === expression
      );
    });
  constructorAdmissionBySymbol.set(symbol, admitted);
  return admitted;
};

const getPropBindingProperty = (
  identifier: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"Property"> | null => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return null;
  const classNode = findEnclosingClass(identifier);
  if (!classNode || findEnclosingClass(symbol.declarationNode) !== classNode) return null;
  const cached = propBindingBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  propBindingBySymbol.set(symbol, null);
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !declaration.init
  )
    return null;
  const owner = findEnclosingFunction(declaration);
  const member = owner?.parent;
  if (
    !isNodeOfType(owner, "FunctionExpression") ||
    !isNodeOfType(member, "MethodDefinition") ||
    member.static ||
    member.value !== owner ||
    member.parent !== classNode.body
  )
    return null;
  const initializer = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(initializer, "MemberExpression") ||
    getStaticPropertyName(initializer) !== "props" ||
    !isNodeOfType(stripParenExpression(initializer.object), "ThisExpression") ||
    symbol.references.some(
      (reference) => reference.identifier !== symbol.bindingIdentifier && reference.flag !== "read",
    )
  )
    return null;
  for (const property of declaration.id.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    const binding = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    if (isNodeOfType(binding, "Identifier") && context.scopes.symbolFor(binding) === symbol) {
      propBindingBySymbol.set(symbol, property);
      return property;
    }
  }
  return null;
};

const isLiteralDataOptions = (node: EsTreeNode): boolean => {
  const candidate = stripParenExpression(node);
  return (
    isNodeOfType(candidate, "ObjectExpression") &&
    candidate.properties.every((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        property.computed ||
        getStaticPropertyKeyName(property) === null ||
        REFLECTION_PROPERTIES.has(getStaticPropertyKeyName(property) ?? "")
      )
        return false;
      const value = stripParenExpression(property.value);
      return (
        isNodeOfType(value, "Literal") &&
        (value.value === null ||
          typeof value.value === "string" ||
          typeof value.value === "number" ||
          typeof value.value === "boolean")
      );
    })
  );
};

const hasAdmittedPropDefault = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  propertyName: string,
  allowLiteralOptions: boolean,
  allowNativeElement = false,
): boolean => {
  const cache = allowLiteralOptions
    ? literalOptionsDefaultByClass
    : allowNativeElement
      ? nativeElementDefaultByClass
      : absentPropDefaultByClass;
  const certificates = cache.get(classBody) ?? new Map<string, boolean>();
  const cached = certificates.get(propertyName);
  if (cached !== undefined) return cached;
  cache.set(classBody, certificates);
  const declarations = classBody.body.filter(
    (member) => getStaticPropertyKeyName(member) === "defaultProps",
  );
  const declaration = declarations[0];
  let admitted = declarations.length === 0;
  if (
    declarations.length === 1 &&
    isNodeOfType(declaration, "PropertyDefinition") &&
    declaration.static &&
    isNodeOfType(declaration.value, "ObjectExpression")
  ) {
    admitted = declaration.value.properties.every((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        getStaticPropertyKeyName(property, { allowComputedString: true }) === null
      )
        return false;
      if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== propertyName)
        return true;
      const value = stripParenExpression(property.value);
      return (
        (allowLiteralOptions && isLiteralDataOptions(value)) ||
        (allowNativeElement &&
          isNodeOfType(value, "Literal") &&
          typeof value.value === "string" &&
          HTML_TAGS.has(value.value))
      );
    });
  }
  certificates.set(propertyName, admitted);
  return admitted;
};

const hasAdmittedOptions = (
  creation: EsTreeNodeOfType<"NewExpression">,
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): boolean => {
  const options = creation.arguments[1];
  if (!options) return true;
  if (isLiteralDataOptions(options)) return true;
  const property = getPropBindingProperty(stripParenExpression(options), context);
  if (
    !property ||
    getStaticPropertyKeyName(property) !== "options" ||
    !isNodeOfType(property.value, "AssignmentPattern")
  )
    return false;
  const fallback = stripParenExpression(property.value.right);
  return (
    isNodeOfType(fallback, "ObjectExpression") &&
    fallback.properties.length === 0 &&
    hasAdmittedPropDefault(classBody, "options", true)
  );
};

const isConditionalPropDelivery = (
  call: EsTreeNodeOfType<"CallExpression">,
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const property = getPropBindingProperty(callee, context);
  const propertyName = property ? getStaticPropertyKeyName(property) : null;
  if (
    !property ||
    !isNodeOfType(property.value, "Identifier") ||
    !propertyName ||
    !hasAdmittedPropDefault(classBody, propertyName, false)
  )
    return false;
  const symbol = context.scopes.symbolFor(callee);
  let ancestor = call.parent;
  while (ancestor && ancestor !== findEnclosingFunction(call)) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      const test = stripParenExpression(ancestor.test);
      if (
        isNodeOfType(test, "Identifier") &&
        context.scopes.symbolFor(test) === symbol &&
        isAstDescendant(call, ancestor.consequent)
      )
        return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isNativeElementType = (
  node: EsTreeNode,
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "Literal"))
    return typeof candidate.value === "string" && HTML_TAGS.has(candidate.value);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const property = getPropBindingProperty(candidate, context);
  return Boolean(
    property &&
    isNodeOfType(property.value, "AssignmentPattern") &&
    isNodeOfType(property.value.right, "Literal") &&
    typeof property.value.right.value === "string" &&
    HTML_TAGS.has(property.value.right.value) &&
    Boolean(getStaticPropertyKeyName(property)) &&
    hasAdmittedPropDefault(classBody, getStaticPropertyKeyName(property) ?? "", false, true),
  );
};

const isDirectRenderReturn = (
  host: EsTreeNode,
  render: EsTreeNode,
  context: RuleContext,
): boolean => {
  const expression = findTransparentExpressionRoot(host);
  const returned = expression.parent;
  return (
    isNodeOfType(returned, "ReturnStatement") &&
    returned.argument === expression &&
    findEnclosingFunction(returned) === render &&
    isNodeReachableWithinFunction(host, context) &&
    isNodeReachableWithinFunction(returned, context)
  );
};

const isNativeRefWrite = (
  member: EsTreeNode,
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): boolean => {
  const assignment = findTransparentExpressionRoot(member).parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.right, "Identifier")
  )
    return false;
  const callback = findEnclosingFunction(assignment);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    context.scopes.symbolFor(callback.params[0]) !== context.scopes.symbolFor(assignment.right)
  )
    return false;
  const body = stripParenExpression(callback.body);
  if (isNodeOfType(body, "BlockStatement")) {
    const runtimeStatements = body.body.filter(
      (statement) =>
        !isNodeOfType(statement, "TSInterfaceDeclaration") &&
        !isNodeOfType(statement, "TSTypeAliasDeclaration"),
    );
    const statement = runtimeStatements[0];
    if (
      runtimeStatements.length !== 1 ||
      !isNodeOfType(statement, "ExpressionStatement") ||
      stripParenExpression(statement.expression) !== assignment
    )
      return false;
  } else if (body !== assignment) return false;
  const renderFunction = findEnclosingFunction(callback);
  const renderMember = renderFunction?.parent;
  if (
    !isNodeOfType(renderFunction, "FunctionExpression") ||
    renderFunction.async ||
    renderFunction.generator ||
    !isNodeOfType(renderMember, "MethodDefinition") ||
    renderMember.parent !== classBody ||
    renderMember.static ||
    renderMember.kind !== "method" ||
    renderMember.value !== renderFunction ||
    getStaticPropertyKeyName(renderMember) !== "render" ||
    classBody.body.filter((member) => getStaticPropertyKeyName(member) === "render").length !== 1
  )
    return false;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const container = callbackRoot.parent;
  if (
    isNodeOfType(container, "JSXExpressionContainer") &&
    isNodeOfType(container.parent, "JSXAttribute") &&
    isNodeOfType(container.parent.name, "JSXIdentifier") &&
    container.parent.name.name === "ref" &&
    isNodeOfType(container.parent.parent, "JSXOpeningElement")
  ) {
    const opening = container.parent.parent;
    if (!hasNativeJsxFactory(opening, context)) return false;
    return (
      isNodeOfType(opening.parent, "JSXElement") &&
      isDirectRenderReturn(opening.parent, renderFunction, context) &&
      isNodeOfType(opening.name, "JSXIdentifier") &&
      HTML_TAGS.has(opening.name.name) &&
      opening.attributes.every(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name !== "is" &&
          (attribute === container.parent || attribute.name.name !== "ref"),
      )
    );
  }
  if (
    !isNodeOfType(container, "Property") ||
    getStaticPropertyKeyName(container) !== "ref" ||
    !isNodeOfType(container.parent, "ObjectExpression") ||
    !isNodeOfType(container.parent.parent, "CallExpression")
  )
    return false;
  const props = container.parent;
  const createElement = props.parent;
  if (
    !isNodeOfType(createElement, "CallExpression") ||
    createElement.arguments[1] !== props ||
    !createElement.arguments[0] ||
    !isNativeElementType(createElement.arguments[0], classBody, context) ||
    !isReactApiCall(createElement, "createElement", context.scopes)
  )
    return false;
  return (
    isDirectRenderReturn(createElement, renderFunction, context) &&
    props.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.method &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== null &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== "is" &&
        (property === container ||
          getStaticPropertyKeyName(property, { allowComputedString: true }) !== "ref"),
    )
  );
};

const getThisMemberName = (node: EsTreeNode): string | null =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(stripParenExpression(node.object), "ThisExpression")
    ? getStaticPropertyName(node)
    : null;

const isImageObserverCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  if (!symbol) return false;
  let admitted = imageObserverAdmissionBySymbol.get(symbol);
  if (admitted === undefined) {
    admitted =
      getValueImportSource(symbol) === "imagesloaded" &&
      isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      symbol.references.every((reference) => {
        if (
          reference.identifier === symbol.bindingIdentifier ||
          isTypeScriptTypePosition(reference.identifier)
        )
          return true;
        const expression = findTransparentExpressionRoot(reference.identifier);
        return (
          reference.flag === "read" &&
          isNodeOfType(expression.parent, "CallExpression") &&
          expression.parent.callee === expression
        );
      });
    imageObserverAdmissionBySymbol.set(symbol, admitted);
  }
  if (!admitted || call.arguments.length !== 2) return false;
  let callback = stripParenExpression(call.arguments[1]);
  if (isNodeOfType(callback, "Identifier")) {
    const callbackSymbol = context.scopes.symbolFor(callback);
    if (!callbackSymbol) return false;
    const cached = imageCallbackAdmissionBySymbol.get(callbackSymbol);
    if (cached !== undefined) return cached;
    const initializer = getDirectConstInitializer(callbackSymbol);
    if (!initializer) return false;
    callback = stripParenExpression(initializer);
    const callbackAdmitted =
      isNodeOfType(callback, "ArrowFunctionExpression") &&
      !callback.async &&
      callback.params.length === 0 &&
      callbackSymbol.references.every(
        (reference) =>
          reference.identifier === callbackSymbol.bindingIdentifier || reference.flag === "read",
      );
    imageCallbackAdmissionBySymbol.set(callbackSymbol, callbackAdmitted);
    return callbackAdmitted;
  }
  return (
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    !callback.async &&
    callback.params.length === 0
  );
};

const hasOwnedElementRef = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  creation: EsTreeNodeOfType<"NewExpression">,
  argument: EsTreeNode,
  context: RuleContext,
): boolean => {
  const fieldName = getThisMemberName(stripParenExpression(argument));
  if (!fieldName) return false;
  const declarations = classBody.body.filter(
    (member) => getStaticPropertyKeyName(member, { allowComputedString: true }) === fieldName,
  );
  if (
    declarations.length !== 1 ||
    !isNodeOfType(declarations[0], "PropertyDefinition") ||
    declarations[0].static ||
    !isNodeOfType(declarations[0].value, "Literal") ||
    declarations[0].value.value !== null ||
    classBody.body.some(
      (member) =>
        ((isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
          member.computed) ||
        getStaticPropertyKeyName(member) === null,
    )
  )
    return false;
  let hasNativeWrite = false;
  let hasOtherUse = false;
  walkAst(classBody, (node) => {
    if (
      !isNodeOfType(node, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(node.object), "ThisExpression")
    )
      return;
    const name = getThisMemberName(node);
    if (isWithinAssignmentTarget(node)) {
      if (name && name !== fieldName) return;
      if (name === fieldName && isNativeRefWrite(node, classBody, context)) hasNativeWrite = true;
      else hasOtherUse = true;
      return;
    }
    if (name !== fieldName) return;
    const expression = findTransparentExpressionRoot(node);
    const parent = expression.parent;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return;
    if (isNodeOfType(parent, "IfStatement") && parent.test === expression) return;
    if (isNodeOfType(parent, "LogicalExpression")) {
      const condition = findTransparentExpressionRoot(parent);
      if (
        (parent.operator === "&&" && parent.left === expression) ||
        (isNodeOfType(condition.parent, "IfStatement") && condition.parent.test === condition)
      )
        return;
    }
    if (parent === creation && creation.arguments[0] === expression) return;
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments[0] === expression &&
      isImageObserverCall(parent, context)
    )
      return;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === expression &&
      getStaticPropertyName(parent) === "querySelector"
    ) {
      const call = findTransparentExpressionRoot(parent).parent;
      if (
        isNodeOfType(call, "CallExpression") &&
        call.callee === findTransparentExpressionRoot(parent) &&
        call.arguments.length === 1 &&
        isNodeOfType(call.arguments[0], "Literal") &&
        typeof call.arguments[0].value === "string"
      )
        return;
    }
    hasOtherUse = true;
  });
  return hasNativeWrite && !hasOtherUse;
};

const hasClosedInstanceSlot = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  fieldName: string,
  context: RuleContext,
): boolean => {
  const declarations = classBody.body.filter(
    (member) => getStaticPropertyKeyName(member) === fieldName,
  );
  if (
    declarations.length !== 1 ||
    !isNodeOfType(declarations[0], "PropertyDefinition") ||
    declarations[0].static ||
    !isNodeOfType(declarations[0].value, "Literal") ||
    declarations[0].value.value !== null
  )
    return false;
  return !someAst(classBody, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      getStaticPropertyName(node.callee) === "destroy"
    )
      return true;
    if (isNodeOfType(node, "ThisExpression")) {
      const expression = findTransparentExpressionRoot(node);
      return !(
        isNodeOfType(expression.parent, "MemberExpression") &&
        expression.parent.object === expression
      );
    }
    if (
      !isNodeOfType(node, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(node.object), "ThisExpression")
    )
      return false;
    const name = getStaticPropertyName(node);
    if (!name) return true;
    if (name !== fieldName) return false;
    const expression = findTransparentExpressionRoot(node);
    const parent = expression.parent;
    if (parent === assignment && assignment.left === expression) return false;
    if (isDirectWrite(node)) return true;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return false;
    if (isNodeOfType(parent, "IfStatement") && parent.test === expression) return false;
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === expression &&
      isConditionalPropDelivery(parent, classBody, context)
    )
      return false;
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== expression) return true;
    const propertyName = getStaticPropertyName(parent);
    if (propertyName === "isActive" || propertyName === "selectedIndex") return false;
    if (propertyName === "options") {
      const next = findTransparentExpressionRoot(parent).parent;
      return (
        !isNodeOfType(next, "MemberExpression") ||
        next.object !== parent ||
        getStaticPropertyName(next) !== "draggable"
      );
    }
    const call = findTransparentExpressionRoot(parent).parent;
    return (
      !propertyName ||
      !NON_DISPOSING_INSTANCE_METHODS.has(propertyName) ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== findTransparentExpressionRoot(parent) ||
      call.arguments.length !== 0
    );
  });
};

export const findUndisposedFlickityCreation = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): EsTreeNodeOfType<"NewExpression"> | null => {
  const classNode = classBody.parent;
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    !classNode.superClass
  )
    return null;
  const superclass = resolveImportedApiReference(classNode.superClass, context.scopes);
  if (
    superclass?.source !== "react" ||
    (superclass.importedName !== "Component" && superclass.importedName !== "PureComponent") ||
    !isProvenReactClassComponent(classNode, context.scopes) ||
    !hasAdmittedProvider(classBody, context) ||
    classBody.body.some((member) => getStaticPropertyKeyName(member) === "componentWillUnmount") ||
    someAst(
      classBody,
      (node) => getThisMemberName(node) === "props" && isWithinAssignmentTarget(node),
    )
  )
    return null;
  const mountMembers = classBody.body.filter(
    (member) => getStaticPropertyKeyName(member) === "componentDidMount",
  );
  const mount = mountMembers[0];
  if (
    mountMembers.length !== 1 ||
    !isNodeOfType(mount, "MethodDefinition") ||
    mount.static ||
    mount.kind !== "method" ||
    mount.value.generator ||
    mount.value.params.length !== 0
  )
    return null;
  const creations: EsTreeNodeOfType<"NewExpression">[] = [];
  walkOwnFunctionScope(mount.value, (node) => {
    if (
      isNodeOfType(node, "NewExpression") &&
      findEnclosingClass(node) === classBody.parent &&
      isNodeReachableWithinFunction(node, context) &&
      isFlickityConstructor(node.callee, context)
    )
      creations.push(node);
  });
  if (creations.length !== 1) return null;
  const creation = creations[0];
  const assignment = findTransparentExpressionRoot(creation).parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== findTransparentExpressionRoot(creation)
  )
    return null;
  const fieldName = getThisMemberName(stripParenExpression(assignment.left));
  if (
    !fieldName ||
    !creation.arguments[0] ||
    !hasAdmittedOptions(creation, classBody, context) ||
    !hasOwnedElementRef(classBody, creation, creation.arguments[0], context) ||
    !hasClosedInstanceSlot(classBody, assignment, fieldName, context)
  )
    return null;
  return creation;
};
