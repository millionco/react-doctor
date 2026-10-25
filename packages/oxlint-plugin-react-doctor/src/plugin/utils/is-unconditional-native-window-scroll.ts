import * as fs from "node:fs";
import * as path from "node:path";
import {
  JSX_BABEL_CONFIG_FILE_NAMES,
  JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
  JSX_TYPESCRIPT_CONFIG_FILE_NAMES,
  STANDARD_REACT_JSX_MODES,
} from "../constants/react.js";
import {
  NATIVE_WINDOW_SCROLL_ALLOWED_WINDOW_MEMBERS,
  NATIVE_WINDOW_SCROLL_PROVIDER_MEMBER_CAPABILITIES,
  NATIVE_WINDOW_SCROLL_REFUSED_MANIFEST_FIELDS,
  NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT,
  NATIVE_WINDOW_SCROLL_REFUSED_ATTRIBUTES,
  NATIVE_WINDOW_SCROLL_REFUSED_GLOBAL_NAMES,
  NATIVE_WINDOW_SCROLL_NEXT_CONFIG_NAMES,
  NATIVE_WINDOW_SCROLL_REFUSED_CONFIG_NAMES,
  NEXT_APPLICATION_SCRIPT_NAME_PATTERN,
  NEXT_APPLICATION_COMMAND_PATTERN,
} from "./constants.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { isComponentFunction } from "./is-component-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isLiteralVoidExpression } from "./is-literal-void-expression.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { isTsconfigObjectRecord, parseTsconfigFile } from "./resolve-tsconfig-alias.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const hasStableWindowProvider = (program: EsTreeNode, context: RuleContext): boolean => {
  const pendingScopes = [context.scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    if (
      scope.symbols.some(
        (symbol) =>
          symbol.name === "window" ||
          symbol.name === "React" ||
          NATIVE_WINDOW_SCROLL_REFUSED_GLOBAL_NAMES.has(symbol.name),
      )
    )
      return false;
    pendingScopes.push(...scope.children);
  }
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super") ||
      isNodeOfType(node, "MetaProperty")
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getResolvedStaticPropertyName(node, context.scopes);
      if (
        (node.computed && name === null) ||
        NATIVE_WINDOW_SCROLL_PROVIDER_MEMBER_CAPABILITIES.has(name ?? "")
      ) {
        supported = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      ["module", "node:module", "vm", "node:vm"].includes(String(node.source.value))
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "WithStatement")) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      ((node.computed && getResolvedStaticPropertyName(node, context.scopes) === null) ||
        NATIVE_WINDOW_SCROLL_PROVIDER_MEMBER_CAPABILITIES.has(
          getResolvedStaticPropertyName(node, context.scopes) ?? "",
        ))
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (node.name === "React" && context.scopes.symbolFor(node)) {
      supported = false;
      return false;
    }
    if (!context.scopes.isGlobalReference(node)) return;
    if (NATIVE_WINDOW_SCROLL_REFUSED_GLOBAL_NAMES.has(node.name)) {
      supported = false;
      return false;
    }
    if (node.name !== "window") return;
    const root = findTransparentExpressionRoot(node);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.optional ||
      member.computed ||
      isMemberMutationTarget(member)
    ) {
      supported = false;
      return false;
    }
    const name = getStaticPropertyName(member);
    if (!name || !NATIVE_WINDOW_SCROLL_ALLOWED_WINDOW_MEMBERS.has(name)) {
      supported = false;
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    if (
      isNodeOfType(memberRoot.parent, "MemberExpression") &&
      memberRoot.parent.object === memberRoot
    ) {
      supported = false;
      return false;
    }
    if (name !== "scrollY") {
      if (
        !isNodeOfType(memberRoot.parent, "CallExpression") ||
        memberRoot.parent.callee !== memberRoot ||
        memberRoot.parent.optional
      )
        supported = false;
    }
  });
  return supported;
};

const hasPassiveNextConfiguration = (filename: string): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return false;
  let pathBinding: string | null = null;
  let exported: EsTreeNode | null = null;
  for (const statement of program.body) {
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.kind === "const" &&
      statement.declarations.length === NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT
    ) {
      const declaration = statement.declarations[0];
      if (
        pathBinding ||
        !isNodeOfType(declaration.id, "Identifier") ||
        !isNodeOfType(declaration.init, "CallExpression") ||
        declaration.init.optional ||
        !isNodeOfType(declaration.init.callee, "Identifier") ||
        declaration.init.callee.name !== "require" ||
        declaration.init.arguments.length !== NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT
      )
        return false;
      const source = declaration.init.arguments[0];
      if (
        !isNodeOfType(source, "Literal") ||
        (source.value !== "path" && source.value !== "node:path")
      )
        return false;
      if (["require", "module", "__dirname"].includes(declaration.id.name)) return false;
      pathBinding = declaration.id.name;
      continue;
    }
    if (isNodeOfType(statement, "ExportDefaultDeclaration") && !exported) {
      exported = statement.declaration;
      continue;
    }
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isNodeOfType(statement.expression, "AssignmentExpression") &&
      statement.expression.operator === "=" &&
      !exported
    ) {
      const target = statement.expression.left;
      if (
        !isNodeOfType(target, "MemberExpression") ||
        target.computed ||
        !isNodeOfType(target.object, "Identifier") ||
        target.object.name !== "module" ||
        getStaticPropertyName(target) !== "exports"
      )
        return false;
      exported = statement.expression.right;
      continue;
    }
    return false;
  }
  if (!exported) return false;
  const options = getOwnDataObjectProperties(exported);
  if (
    !options ||
    [...options.keys()].some(
      (name) =>
        name !== "images" &&
        name !== "sassOptions" &&
        name !== "reactStrictMode" &&
        name !== "poweredByHeader",
    )
  )
    return false;
  const passiveValue = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "Literal"))
      return (
        node.value === null ||
        typeof node.value === "string" ||
        typeof node.value === "boolean" ||
        (typeof node.value === "number" && Number.isFinite(node.value))
      );
    if (isNodeOfType(node, "ArrayExpression"))
      return node.elements.every((element) => Boolean(element && passiveValue(element)));
    const properties = getOwnDataObjectProperties(node);
    return Boolean(properties && [...properties.values()].every(passiveValue));
  };
  for (const [name, value] of options) {
    if (name !== "sassOptions") {
      if (!passiveValue(value)) return false;
      continue;
    }
    const sass = getOwnDataObjectProperties(value);
    const includes = sass?.get("includePaths");
    if (
      !sass ||
      sass.size !== NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT ||
      !isNodeOfType(includes, "ArrayExpression")
    )
      return false;
    for (const entry of includes.elements) {
      if (
        !isNodeOfType(entry, "CallExpression") ||
        entry.optional ||
        !isNodeOfType(entry.callee, "MemberExpression") ||
        entry.callee.computed ||
        entry.callee.optional ||
        !isNodeOfType(entry.callee.object, "Identifier") ||
        entry.callee.object.name !== pathBinding ||
        getStaticPropertyName(entry.callee) !== "join"
      )
        return false;
      const [directory, ...segments] = entry.arguments;
      if (
        !isNodeOfType(directory, "Identifier") ||
        directory.name !== "__dirname" ||
        segments.length === 0 ||
        segments.some(
          (segment) => !isNodeOfType(segment, "Literal") || typeof segment.value !== "string",
        )
      )
        return false;
    }
  }
  return true;
};

const hasNativeWindowScrollEnvironment = (program: EsTreeNode, context: RuleContext): boolean => {
  const filename = context.filename;
  const sourceText = context.sourceCode?.getText?.();
  if (
    !filename ||
    sourceText === undefined ||
    hasJsxRuntimePragma({ filename, program, sourceText })
  )
    return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  const manifest = readNearestPackageManifest(filename);
  const declaredReact =
    manifest?.dependencies?.react ??
    manifest?.devDependencies?.react ??
    manifest?.peerDependencies?.react;
  if (
    !packageDirectory ||
    !manifest ||
    typeof declaredReact !== "string" ||
    !parsePackageVersion(declaredReact.trim().replace(/^[~^]/u, ""))
  )
    return false;
  if (NATIVE_WINDOW_SCROLL_REFUSED_MANIFEST_FIELDS.some((name) => Object.hasOwn(manifest, name)))
    return false;
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (
      NEXT_APPLICATION_SCRIPT_NAME_PATTERN.test(name) &&
      (typeof manifest.dependencies?.next !== "string" ||
        !parsePackageVersion(manifest.dependencies.next.trim().replace(/^[~^]/u, "")) ||
        typeof command !== "string" ||
        !NEXT_APPLICATION_COMMAND_PATTERN.test(command))
    )
      return false;
  }
  let directory = path.dirname(path.resolve(filename));
  while (true) {
    const packageFilename = path.join(directory, "package.json");
    recordExistenceProbe(packageFilename);
    const packageStat = fs.lstatSync(packageFilename, { throwIfNoEntry: false });
    if (packageStat && !packageStat.isFile()) return false;
    const ancestorManifest = readPackageManifest(directory);
    if (
      ancestorManifest &&
      NATIVE_WINDOW_SCROLL_REFUSED_MANIFEST_FIELDS.some((name) =>
        Object.hasOwn(ancestorManifest, name),
      )
    )
      return false;
    for (const name of [
      ...JSX_BABEL_CONFIG_FILE_NAMES,
      ...JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
      ...NATIVE_WINDOW_SCROLL_REFUSED_CONFIG_NAMES,
    ]) {
      const configPath = path.join(directory, name);
      recordExistenceProbe(configPath);
      if (fs.existsSync(configPath)) return false;
    }
    for (const name of JSX_TYPESCRIPT_CONFIG_FILE_NAMES) {
      const configPath = path.join(directory, name);
      recordExistenceProbe(configPath);
      if (!fs.existsSync(configPath)) continue;
      if (!fs.lstatSync(configPath).isFile()) return false;
      const configuration = parseTsconfigFile(configPath, [], true);
      if (!configuration || Array.isArray(configuration) || Object.hasOwn(configuration, "extends"))
        return false;
      const options = configuration.compilerOptions ?? {};
      if (
        !isTsconfigObjectRecord(options) ||
        Array.isArray(options) ||
        Object.hasOwn(options, "baseUrl") ||
        Object.hasOwn(options, "plugins") ||
        Object.hasOwn(options, "moduleSuffixes") ||
        Object.hasOwn(options, "customConditions") ||
        Object.hasOwn(options, "jsxFactory") ||
        Object.hasOwn(options, "jsxFragmentFactory") ||
        (Object.hasOwn(options, "jsxImportSource") && options.jsxImportSource !== "react") ||
        (Object.hasOwn(options, "jsx") &&
          (typeof options.jsx !== "string" || !STANDARD_REACT_JSX_MODES.has(options.jsx)))
      )
        return false;
      if (Object.hasOwn(options, "paths")) {
        if (!isTsconfigObjectRecord(options.paths) || Array.isArray(options.paths)) return false;
        for (const [pattern, targets] of Object.entries(options.paths)) {
          if (
            !pattern.startsWith("@/") ||
            pattern.indexOf("*") !== pattern.length - NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT ||
            !Array.isArray(targets) ||
            targets.some((target) => typeof target !== "string" || !target.startsWith("./"))
          )
            return false;
        }
      }
    }
    for (const name of NATIVE_WINDOW_SCROLL_NEXT_CONFIG_NAMES) {
      const configPath = path.join(directory, name);
      recordExistenceProbe(configPath);
      if (
        fs.existsSync(configPath) &&
        (directory !== packageDirectory ||
          !fs.lstatSync(configPath).isFile() ||
          !hasPassiveNextConfiguration(configPath))
      )
        return false;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return true;
    directory = parent;
  }
};

const isDirectButtonHandler = (
  value: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const root = findTransparentExpressionRoot(value);
  const container = root.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== root ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "onClick" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "button"
  )
    return false;
  if (
    opening.attributes.filter(
      (candidate) =>
        isNodeOfType(candidate, "JSXAttribute") &&
        isNodeOfType(candidate.name, "JSXIdentifier") &&
        candidate.name.name === "onClick",
    ).length !== NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT
  )
    return false;
  if (
    opening.attributes.some(
      (candidate) =>
        !isNodeOfType(candidate, "JSXAttribute") ||
        !isNodeOfType(candidate.name, "JSXIdentifier") ||
        NATIVE_WINDOW_SCROLL_REFUSED_ATTRIBUTES.has(candidate.name.name) ||
        (/^on/iu.test(candidate.name.name) && candidate !== attribute),
    )
  )
    return false;
  const element = opening.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const elementRoot = findTransparentExpressionRoot(element);
  if (
    !isFunctionLike(component) ||
    component.async ||
    component.generator ||
    !isComponentFunction(component)
  )
    return false;
  if (
    !isNodeOfType(component, "FunctionDeclaration") &&
    !getDirectFunctionBindingIdentifier(component) &&
    !isNodeOfType(component.parent, "ExportDefaultDeclaration")
  )
    return false;
  if (
    isNodeOfType(component.body, "BlockStatement") &&
    component.body.body.some(
      (statement) =>
        !isNodeOfType(statement, "VariableDeclaration") &&
        !isNodeOfType(statement, "ExpressionStatement") &&
        !isNodeOfType(statement, "ReturnStatement") &&
        !isNodeOfType(statement, "EmptyStatement"),
    )
  )
    return false;
  if (component.body === elementRoot) return true;
  const returned = elementRoot.parent;
  return Boolean(
    isNodeOfType(returned, "ReturnStatement") &&
    returned.argument === elementRoot &&
    returned.parent === component.body &&
    isNodeOnUnconditionalPath(returned, component) &&
    isNodeReachableWithinFunction(returned, context),
  );
};

export const isUnconditionalNativeWindowScroll = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (call.optional || call.arguments.length !== NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT)
    return false;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    getStaticPropertyName(callee) !== "scrollTo"
  )
    return false;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "window" ||
    !context.scopes.isGlobalReference(receiver) ||
    !isProvenUnmodifiedGlobalNamespaceReference(receiver, "window", context.scopes)
  )
    return false;
  const options = getOwnDataObjectProperties(stripParenExpression(call.arguments[0]));
  const behaviorValue = options?.get("behavior");
  const behavior = behaviorValue ? stripParenExpression(behaviorValue) : null;
  if (!options || !isNodeOfType(behavior, "Literal") || behavior.value !== "smooth") return false;
  for (const [name, value] of options) {
    if (name === "behavior") continue;
    const coordinate = stripParenExpression(value);
    const literal =
      isNodeOfType(coordinate, "UnaryExpression") &&
      (coordinate.operator === "+" || coordinate.operator === "-")
        ? coordinate.argument
        : coordinate;
    if (
      (name !== "top" && name !== "left") ||
      !isNodeOfType(literal, "Literal") ||
      typeof literal.value !== "number" ||
      !Number.isFinite(literal.value)
    )
      return false;
  }
  const callRoot = findTransparentExpressionRoot(call);
  let handler: EsTreeNode | null | undefined = callRoot.parent;
  if (isNodeOfType(handler, "ExpressionStatement") || isNodeOfType(handler, "ReturnStatement")) {
    const body = handler.parent;
    if (!isNodeOfType(body, "BlockStatement")) return false;
    const activeStatements = body.body.filter(
      (statement) =>
        !isNodeOfType(statement, "EmptyStatement") &&
        !(
          isNodeOfType(statement, "ExpressionStatement") &&
          isLiteralVoidExpression(statement.expression)
        ),
    );
    if (
      activeStatements.length !== NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT ||
      activeStatements[0] !== handler
    )
      return false;
    handler = body.parent;
  }
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length !== 0
  )
    return false;
  if (handler.body !== callRoot && !isNodeOfType(handler.body, "BlockStatement")) return false;
  const program = context.scopes.rootScope.node;
  const binding = getDirectFunctionBindingIdentifier(handler);
  let admitted = false;
  if (binding) {
    const symbol = context.scopes.symbolFor(binding);
    const declaration = findTransparentExpressionRoot(handler).parent;
    const component = declaration?.parent?.parent?.parent;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.declarations.length !== NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT ||
      !isFunctionLike(component) ||
      declaration.parent.parent !== component.body ||
      symbol.references.length === 0 ||
      !isNodeReachableWithinFunction(declaration, context)
    )
      return false;
    const allowed = new Set<EsTreeNode>();
    for (const reference of symbol.references)
      if (isDirectButtonHandler(reference.identifier, component, context))
        allowed.add(reference.identifier);
    admitted = hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers: allowed,
      program,
      scopes: context.scopes,
    });
  } else {
    const container = findTransparentExpressionRoot(handler).parent;
    const element = container?.parent?.parent?.parent;
    const elementRoot = element ? findTransparentExpressionRoot(element) : null;
    const parent = elementRoot?.parent;
    const component = isNodeOfType(parent, "ReturnStatement") ? parent.parent?.parent : parent;
    admitted = Boolean(component && isDirectButtonHandler(handler, component, context));
  }
  return (
    admitted &&
    hasStableWindowProvider(program, context) &&
    hasNativeWindowScrollEnvironment(program, context)
  );
};
