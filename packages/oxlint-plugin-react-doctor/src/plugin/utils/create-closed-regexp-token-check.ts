import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  REGEXP_TOKEN_PROJECT_MAX_FILES,
  REGEXP_TOKEN_PROP_MAX_HOPS,
} from "../constants/thresholds.js";
import {
  buildSourceProjectIndex,
  SOURCE_PROJECT_BUILD_CONFIG_PATTERN,
  type SourceProjectIndex,
  type SourceProjectModule,
} from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { getClosedJsxCallSites } from "./get-closed-jsx-call-sites.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isClosedObjectKeyMapItem } from "./is-closed-object-key-map-item.js";
import { isFunctionLike } from "./is-function-like.js";
import { isInstalledStaticVirtualModule } from "./is-installed-static-virtual-module.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { normalizeFilename } from "./normalize-filename.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";
import { readStaticAstroVirtualModuleRequirement } from "./read-static-astro-virtual-module-requirement.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface DirectMemberCall {
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly member: EsTreeNodeOfType<"MemberExpression">;
}

const ROOT_ASTRO_ESM_CONFIG_PATTERN = /^astro\.config\.m?[jt]s$/;
const ASTRO_BUILT_IN_MODULES = new Set([
  "astro:components",
  "astro:transitions",
  "astro:transitions/client",
]);
const ORDINARY_MODULE_SOURCE_PATTERN = /^(?:node:)?(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/;
const OBJECT_READ_METHODS = new Set(["keys", "values", "entries", "hasOwn"]);
const INTRINSIC_NAMES = new Set(["Array", "Object", "RegExp", "String"]);
const INTRINSIC_ESCAPE_PROPERTIES = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "contentWindow",
  "defaultView",
]);
const TOKEN_INTRINSIC_METHODS = new Set(["filter", "keys", "map", "match", "slice", "split"]);
const OPAQUE_NODE_MODULE_SOURCES = new Set(["module", "vm", "node:module", "node:vm"]);
const WINDOW_LOCATION_READ_PROPERTIES = new Set(["hash", "pathname", "search"]);
const WINDOW_SUBSCRIPTION_EVENTS = new Set(["hashchange", "keydown"]);

const isOrdinaryWindowUse = (window: EsTreeNode): boolean => {
  const access = window.parent;
  if (isNodeOfType(access, "IfStatement") && access.test === window) return true;
  if (!isNodeOfType(access, "MemberExpression") || access.object !== window) return false;
  const property = getStaticPropertyKeyName(access);
  if (property === "location") {
    const locationRead = access.parent;
    const locationProperty = locationRead && getStaticPropertyKeyName(locationRead);
    return (
      isNodeOfType(locationRead, "MemberExpression") &&
      locationRead.object === access &&
      Boolean(locationProperty && WINDOW_LOCATION_READ_PROPERTIES.has(locationProperty)) &&
      (locationProperty === "hash" || !isWithinAssignmentTarget(locationRead))
    );
  }
  if (property !== "addEventListener" && property !== "removeEventListener") return false;
  const call = access.parent;
  return (
    isNodeOfType(call, "CallExpression") &&
    call.callee === access &&
    isNodeOfType(call.arguments[0], "Literal") &&
    typeof call.arguments[0].value === "string" &&
    WINDOW_SUBSCRIPTION_EVENTS.has(call.arguments[0].value)
  );
};

const isDirectDocumentQuery = (document: EsTreeNode): boolean => {
  const access = document.parent;
  const call = access?.parent;
  return (
    isNodeOfType(access, "MemberExpression") &&
    access.object === document &&
    getStaticPropertyKeyName(access) === "querySelector" &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === access &&
    call.arguments.length === 1 &&
    isNodeOfType(call.arguments[0], "Literal") &&
    typeof call.arguments[0].value === "string"
  );
};

const isAstroPropsRead = (node: EsTreeNode, { filePath, scopes }: SourceProjectModule): boolean => {
  if (
    !filePath.endsWith(".astro") ||
    !isNodeOfType(node, "MemberExpression") ||
    !isNodeOfType(node.object, "Identifier") ||
    node.object.name !== "Astro" ||
    isWithinAssignmentTarget(node)
  )
    return false;
  if (scopes.isGlobalReference(node.object)) return true;
  const binding = scopes.symbolFor(node.object);
  const declaration = binding?.declarationNode.parent;
  return Boolean(
    binding?.kind === "const" &&
    binding.initializer === null &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.declare &&
    binding.references.every(({ flag }) => flag === "read"),
  );
};

const hasOrdinaryIntrinsicReferences = (module: SourceProjectModule): boolean => {
  const { programNode, scopes } = module;
  let isOrdinary = true;
  walkAst(programNode, (node) => {
    if (!isOrdinary) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const key = getResolvedStaticPropertyName(node, scopes, {
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        key === "cloneElement" ||
        (key === "props" && !isAstroPropsRead(node, module)) ||
        (key !== null && INTRINSIC_ESCAPE_PROPERTIES.has(key)) ||
        (isNodeOfType(node, "MemberExpression") &&
          isWithinAssignmentTarget(node) &&
          (key === null || TOKEN_INTRINSIC_METHODS.has(key) || INTRINSIC_NAMES.has(key)))
      ) {
        isOrdinary = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "ImportExpression") &&
      (!isNodeOfType(node.source, "Literal") || typeof node.source.value !== "string")
    ) {
      isOrdinary = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    if (node.name === "cloneElement") {
      isOrdinary = false;
      return false;
    }
    if (!scopes.isGlobalReference(node)) return;
    const parent = node.parent;
    switch (node.name) {
      case "eval":
      case "Function":
      case "Reflect":
        isOrdinary = false;
        return false;
      case "globalThis":
        isOrdinary =
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === node &&
          getStaticPropertyKeyName(parent) === "window" &&
          isOrdinaryWindowUse(parent);
        break;
      case "global":
      case "self":
        isOrdinary = isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof";
        break;
      case "window":
        isOrdinary =
          (isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") ||
          isOrdinaryWindowUse(node);
        break;
      case "document":
        isOrdinary = isDirectDocumentQuery(node);
        break;
      case "RegExp":
        isOrdinary = isNodeOfType(parent, "NewExpression") && parent.callee === node;
        break;
      case "String":
        isOrdinary = isNodeOfType(parent, "CallExpression") && parent.callee === node;
        break;
      case "Array":
        isOrdinary = false;
        break;
      case "require": {
        const source = isNodeOfType(parent, "CallExpression") ? parent.arguments[0] : null;
        isOrdinary =
          isNodeOfType(parent, "CallExpression") &&
          parent.callee === node &&
          !parent.optional &&
          parent.arguments.length === 1 &&
          isNodeOfType(source, "Literal") &&
          typeof source.value === "string" &&
          !OPAQUE_NODE_MODULE_SOURCES.has(source.value);
        break;
      }
      case "Object":
        isOrdinary =
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === node &&
          !parent.computed &&
          isNodeOfType(parent.property, "Identifier") &&
          OBJECT_READ_METHODS.has(parent.property.name) &&
          isNodeOfType(parent.parent, "CallExpression") &&
          parent.parent.callee === parent;
        break;
      default:
        break;
    }
  });
  return isOrdinary;
};

const hasClosedProjectSurface = (
  project: SourceProjectIndex,
  rootDirectory: string,
  isEsmPackage: boolean,
): boolean => {
  if (project.hasOpaqueMdxConsumerSurface || project.htmlFilePaths.length > 0) return false;
  let verifiedVirtualSource: string | null = null;
  for (const module of project.modulesByFilePath.values()) {
    if (!hasOrdinaryIntrinsicReferences(module)) return false;
    if (!SOURCE_PROJECT_BUILD_CONFIG_PATTERN.test(module.filePath)) continue;
    if (
      !isEsmPackage ||
      verifiedVirtualSource ||
      !ROOT_ASTRO_ESM_CONFIG_PATTERN.test(module.filePath.slice(rootDirectory.length + 1))
    )
      return false;
    const recipe = readStaticAstroVirtualModuleRequirement(module);
    if (!recipe || !isInstalledStaticVirtualModule({ configFilename: module.filePath, recipe }))
      return false;
    verifiedVirtualSource = recipe.virtualSource;
  }
  return [...project.unresolvedRuntimeSources].every(
    (source) =>
      source === verifiedVirtualSource ||
      (verifiedVirtualSource !== null && ASTRO_BUILT_IN_MODULES.has(source)) ||
      (!source.startsWith(".") &&
        !OPAQUE_NODE_MODULE_SOURCES.has(source) &&
        ORDINARY_MODULE_SOURCE_PATTERN.test(source)),
  );
};

const getDirectMemberCall = (expression: EsTreeNode, name: string): DirectMemberCall | null => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    !isNodeOfType(call.callee.property, "Identifier") ||
    call.callee.property.name !== name
  )
    return null;
  return { call, member: call.callee };
};

const isDirectPropPattern = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ObjectPattern") &&
  node.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      isNodeOfType(property.value, "Identifier"),
  );

const getPropValueReferences = (symbol: SymbolDescriptor) => {
  const property = symbol.bindingIdentifier.parent;
  return symbol.references.filter(
    ({ identifier }) =>
      !(
        isNodeOfType(property, "Property") &&
        property.shorthand &&
        property.value === symbol.bindingIdentifier &&
        property.key === identifier &&
        isNodeOfType(property.parent, "ObjectPattern")
      ),
  );
};

const readJsxPropValue = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
): EsTreeNode | null | undefined => {
  if (name === "children" || name === "key" || name === "ref") return undefined;
  let value: EsTreeNode | null = null;
  for (const attribute of opening.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return undefined;
    if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== name) continue;
    if (value || !attribute.value) return undefined;
    if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
      if (isNodeOfType(attribute.value.expression, "JSXEmptyExpression")) return undefined;
      value = stripParenExpression(attribute.value.expression);
    } else if (isNodeOfType(attribute.value, "Literal")) {
      value = attribute.value;
    } else {
      return undefined;
    }
  }
  return value;
};

const isFreshRegExp = (value: EsTreeNode, module: SourceProjectModule): boolean => {
  const expression = stripParenExpression(value);
  if (
    !isNodeOfType(expression, "NewExpression") ||
    !isNodeOfType(expression.callee, "Identifier") ||
    expression.callee.name !== "RegExp" ||
    !module.scopes.isGlobalReference(expression.callee)
  )
    return false;
  const [pattern, flags, ...extraArguments] = expression.arguments;
  return Boolean(
    pattern &&
    (isNodeOfType(pattern, "TemplateLiteral") ||
      (isNodeOfType(pattern, "Literal") && typeof pattern.value === "string") ||
      (isNodeOfType(pattern, "BinaryExpression") && pattern.operator === "+")) &&
    (!flags || (isNodeOfType(flags, "Literal") && typeof flags.value === "string")) &&
    extraArguments.length === 0,
  );
};

const isClosedRegExpValue = (
  value: EsTreeNode,
  module: SourceProjectModule,
  project: SourceProjectIndex,
  depth: number,
): boolean => {
  if (isFreshRegExp(value, module)) return true;
  if (!isNodeOfType(value, "Identifier")) return false;
  const symbol = module.scopes.symbolFor(value);
  const references = symbol && getPropValueReferences(symbol);
  if (
    !symbol ||
    references?.length !== 1 ||
    references[0]?.identifier !== value ||
    references[0]?.flag !== "read"
  )
    return false;
  if (symbol.kind === "const" && symbol.initializer) {
    return (
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier &&
      symbol.declarationNode.range[1] < value.range[0] &&
      isFreshRegExp(symbol.initializer, module)
    );
  }
  if (symbol.kind !== "parameter" || depth >= REGEXP_TOKEN_PROP_MAX_HOPS) return false;
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  if (!isNodeOfType(property, "Property") || property.value !== symbol.bindingIdentifier)
    return false;
  if (!pattern || !isDirectPropPattern(pattern)) return false;
  const owner = pattern.parent;
  if (!isFunctionLike(owner) || owner.params[0] !== pattern) return false;
  const name = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  const callers = getClosedJsxCallSites(module, owner, project);
  return Boolean(
    name &&
    callers?.length &&
    callers.every((site) => {
      const argument = readJsxPropValue(site.opening, name);
      return Boolean(argument && isClosedRegExpValue(argument, site.module, project, depth + 1));
    }),
  );
};

const findRegExpGuard = (
  split: EsTreeNode,
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
): EsTreeNode | null => {
  let child = split;
  for (let parent = child.parent; parent; parent = child.parent) {
    if (isFunctionLike(parent)) return null;
    if (
      isNodeOfType(parent, "IfStatement") &&
      child === parent.consequent &&
      module.scopes.symbolFor(parent.test) === symbol
    )
      return parent.test;
    if (isNodeOfType(parent, "BlockStatement")) {
      for (const statement of parent.body) {
        if (statement === child) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          isNodeOfType(statement.test, "UnaryExpression") &&
          statement.test.operator === "!" &&
          module.scopes.symbolFor(statement.test.argument) === symbol &&
          isNodeOfType(statement.consequent, "ReturnStatement")
        )
          return statement.test.argument;
      }
    }
    child = parent;
  }
  return null;
};

export const createClosedRegExpTokenCheck = (context: RuleContext) => {
  const filename = context.filename ? normalizeFilename(context.filename) : "";
  const rootSetting = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const rootDirectory = rootSetting ? normalizeFilename(rootSetting).replace(/\/$/, "") : "";
  let project: SourceProjectIndex | null | undefined;
  return (iterator: EsTreeNode): boolean => {
    if (!rootDirectory || !filename.startsWith(`${rootDirectory}/`)) return false;
    const map = getDirectMemberCall(iterator, "map");
    const callback = map?.call.arguments[0];
    const callbackBody =
      isNodeOfType(callback, "ArrowFunctionExpression") && stripParenExpression(callback.body);
    if (
      !map ||
      map.call.arguments.length !== 1 ||
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      callback.async ||
      callback.params.length !== 2 ||
      !callback.params.every((param) => isNodeOfType(param, "Identifier")) ||
      !callbackBody ||
      !isNodeOfType(callbackBody, "ConditionalExpression")
    )
      return false;
    const split = getDirectMemberCall(map.member.object, "split");
    const matcher = split?.call.arguments[0];
    const receiver = split?.member.object;
    if (
      !split ||
      split.call.arguments.length !== 1 ||
      !isNodeOfType(matcher, "Identifier") ||
      !isNodeOfType(receiver, "MemberExpression") ||
      receiver.optional ||
      receiver.computed ||
      !isNodeOfType(receiver.property, "Identifier") ||
      !isNodeOfType(receiver.object, "Identifier")
    )
      return false;
    const { scopes } = context;
    const props = scopes.symbolFor(receiver.object);
    const regex = scopes.symbolFor(matcher);
    if (props?.kind !== "parameter" || regex?.kind !== "const") return false;
    const owner = findEnclosingFunction(props.bindingIdentifier);
    const binding = regex.bindingIdentifier.parent;
    const pattern = binding?.parent;
    if (
      !isFunctionLike(owner) ||
      owner.params[0] !== props.bindingIdentifier ||
      !isNodeOfType(binding, "Property") ||
      binding.value !== regex.bindingIdentifier ||
      !pattern ||
      !isDirectPropPattern(pattern) ||
      !isNodeOfType(pattern.parent, "VariableDeclarator") ||
      pattern.parent.id !== pattern ||
      !isNodeOfType(pattern.parent.init, "Identifier") ||
      scopes.symbolFor(pattern.parent.init) !== props
    )
      return false;
    if (
      props.references.some(({ identifier, flag }) => {
        if (flag !== "read") return true;
        const parent = identifier.parent;
        return (
          parent !== pattern.parent &&
          !(isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") &&
          !(
            isNodeOfType(parent, "MemberExpression") &&
            parent.object === identifier &&
            !parent.computed &&
            !isWithinAssignmentTarget(parent)
          )
        );
      })
    )
      return false;
    const regexProp = getDestructuredBindingPropertyName(regex.bindingIdentifier);
    const item = callback.params[0];
    const itemSymbol = isNodeOfType(item, "Identifier") ? scopes.symbolFor(item) : null;
    const program = findProgramRoot(iterator);
    const match = getDirectMemberCall(callbackBody.test, "match");
    if (
      !regexProp ||
      !itemSymbol ||
      itemSymbol.references.some(({ flag }) => flag !== "read") ||
      !program ||
      !match ||
      match.call.arguments.length !== 1 ||
      scopes.symbolFor(match.call.arguments[0]) !== regex ||
      scopes.symbolFor(match.member.object) !== itemSymbol ||
      scopes.symbolFor(callbackBody.alternate) !== itemSymbol ||
      !isNodeOfType(callbackBody.consequent, "JSXElement")
    )
      return false;
    const module = { filePath: filename, programNode: program, scopes };
    const guard = findRegExpGuard(split.call, regex, module);
    const regexReferences = getPropValueReferences(regex);
    if (!guard || regexReferences.length !== 3) return false;
    if (
      !regexReferences.every(
        ({ identifier, flag }) =>
          flag === "read" &&
          (identifier === matcher ||
            identifier === guard ||
            identifier === match.call.arguments[0]),
      )
    )
      return false;
    if (project === undefined) {
      const manifest = readNearestPackageManifest(filename);
      const packageDirectory = findNearestPackageDirectory(filename);
      if (
        manifest?.private !== true ||
        manifest.exports !== undefined ||
        !packageDirectory ||
        normalizeFilename(packageDirectory) !== rootDirectory
      ) {
        project = null;
      } else {
        const indexed = buildSourceProjectIndex({
          rootDirectory,
          currentFilePath: filename,
          currentProgramNode: program,
          currentScopes: scopes,
          includeAstroSources: true,
          maximumSourceFiles: REGEXP_TOKEN_PROJECT_MAX_FILES,
        });
        project =
          indexed && hasClosedProjectSurface(indexed, rootDirectory, manifest.type === "module")
            ? indexed
            : null;
      }
    }
    if (!project) return false;
    const callers = getClosedJsxCallSites(module, owner, project);
    if (!callers?.length) return false;
    let hasActiveCaller = false;
    for (const site of callers) {
      const regexValue = readJsxPropValue(site.opening, regexProp);
      if (regexValue === null) continue;
      if (!regexValue || !isClosedRegExpValue(regexValue, site.module, project, 1)) return false;
      const textValue = readJsxPropValue(site.opening, receiver.property.name);
      if (
        !textValue ||
        !(
          (isNodeOfType(textValue, "Literal") && typeof textValue.value === "string") ||
          isClosedObjectKeyMapItem(textValue, site.module)
        )
      )
        return false;
      hasActiveCaller = true;
    }
    return hasActiveCaller;
  };
};
