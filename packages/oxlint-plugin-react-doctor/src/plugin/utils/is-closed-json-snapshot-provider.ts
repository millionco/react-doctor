import { isClosedJsonSnapshotPublicEntry } from "./is-closed-json-snapshot-public-entry.js";
import { getFiniteStaticStringValues } from "./get-finite-static-string-values.js";
import { isPassiveValueUse } from "./is-passive-value-use.js";
import { hasClosedJsonSnapshotJsxReferences } from "./has-closed-json-snapshot-jsx-references.js";
import { isClosedJsonSnapshotSideEffectRequire } from "./is-closed-json-snapshot-side-effect-require.js";
import {
  SNAPSHOT_BOOTSTRAP_PACKAGE_NAMES,
  SNAPSHOT_WEBPACK_MODULE_ARGUMENT_NAMES,
  SNAPSHOT_WEBPACK_RUNTIME_NAMES,
} from "./closed-json-snapshot-config/constants.js";
import type { SymbolDescriptor, ReferenceDescriptor } from "../semantic/scope-analysis.js";
import {
  CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT,
  CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN,
} from "./closed-json-snapshot/constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type {
  ClosedJsonSnapshotModule,
  ClosedJsonSnapshotProject,
} from "./get-closed-json-snapshot-project.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getClosedJsonSnapshotProviderBody } from "./get-closed-json-snapshot-provider-body.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { isClosedJsonSnapshotInactiveBranch } from "./is-closed-json-snapshot-inactive-branch.js";
import { hasClosedJsonSnapshotTransformBindings } from "./has-closed-json-snapshot-transform-bindings.js";
import { isFunctionLike } from "./is-function-like.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ClosedJsonSnapshotProviderInput {
  readonly project: ClosedJsonSnapshotProject;
  readonly module: ClosedJsonSnapshotModule;
  readonly helperFunction: EsTreeNode;
  readonly decoderRole: "browser-native-json";
  readonly allowsAxiosDefaultResponseSnapshot?: boolean;
  readonly invocation?: SnapshotProviderInvocation;
}

interface SnapshotProviderInvocation {
  readonly module: ClosedJsonSnapshotModule;
  readonly call: EsTreeNode;
}

interface SnapshotRequestArgument {
  readonly module: ClosedJsonSnapshotModule;
  readonly parameter: SymbolDescriptor;
  readonly properties: ReadonlyMap<string, EsTreeNode>;
  readonly references: Set<EsTreeNode>;
}

interface SnapshotApprovedRequest {
  readonly module: ClosedJsonSnapshotModule;
  readonly call: EsTreeNode;
}

interface SnapshotClientBinding {
  readonly module: ClosedJsonSnapshotModule;
  readonly symbol: SymbolDescriptor;
  readonly isAxios: boolean;
}

const REQUEST_OPTION_NAMES = new Set([
  "url",
  "method",
  "baseURL",
  "timeout",
  "responseType",
  "headers",
  "params",
  "data",
  "withCredentials",
]);
const CLIENT_DEFAULT_NAMES = new Set(["baseURL", "timeout"]);
const SNAPSHOT_NATIVE_GLOBAL_NAMES = new Set([
  "JSON",
  "Symbol",
  "Promise",
  "XMLHttpRequest",
  "Object",
  "Array",
]);
const SNAPSHOT_NATIVE_OBJECT_READS = new Set(["keys", "values", "entries", "is"]);
const SNAPSHOT_NATIVE_JSON_METHODS = new Set(["parse", "stringify"]);
const SNAPSHOT_NATIVE_SYMBOL_METHODS = new Set(["for", "keyFor"]);
const SNAPSHOT_NATIVE_PROMISE_METHODS = new Set([
  "resolve",
  "reject",
  "all",
  "race",
  "allSettled",
  "any",
]);
const SNAPSHOT_NATIVE_TIMER_NAMES = new Set(["setTimeout", "setInterval"]);
const SNAPSHOT_EXECUTABLE_JSX_TAG_NAMES = new Set(["script", "iframe", "object", "embed", "frame"]);
const SNAPSHOT_EXECUTABLE_JSX_ATTRIBUTE_NAMES = new Set(["dangerouslySetInnerHTML", "srcDoc"]);
const SNAPSHOT_SHARED_PROTOTYPE_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);
const SNAPSHOT_GLOBAL_GATEWAY_NAMES = new Set([
  "defaultView",
  "parentWindow",
  "contentWindow",
  "contentDocument",
  "ownerDocument",
  "parent",
  "top",
  "opener",
  "frames",
  "global",
  "globalThis",
  "window",
  "self",
  "view",
  "currentTarget",
  "target",
  "source",
  "caller",
  "callee",
  "arguments",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
]);
const SNAPSHOT_REACT_API_NAMES = new Set([
  "isValidElement",
  "createContext",
  "forwardRef",
  "lazy",
  "memo",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useEffect",
  "useImperativeHandle",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
]);
const SNAPSHOT_REACT_DOM_API_NAMES = new Set([
  "render",
  "hydrate",
  "createPortal",
  "findDOMNode",
  "unmountComponentAtNode",
  "flushSync",
  "unstable_batchedUpdates",
  "unstable_renderSubtreeIntoContainer",
]);
const SNAPSHOT_BROWSER_API_NAMES = new Set([
  "addEventListener",
  "removeEventListener",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "scrollTo",
  "scrollBy",
]);
const SNAPSHOT_DOCUMENT_LOOKUP_NAMES = new Set(["getElementById", "querySelector"]);
const SNAPSHOT_SOURCE_EVENT_TARGET_NAMES = new Set(["target", "currentTarget"]);
const SNAPSHOT_SOURCE_EVENT_VALUE_NAMES = new Set(["value", "checked", "name", "id", "type"]);
const SNAPSHOT_SOURCE_REACT_COMPONENT_NAMES = new Set([
  "Fragment",
  "StrictMode",
  "Suspense",
  "Profiler",
]);
const SNAPSHOT_LIVE_HMR_SOURCE_PATTERN = /^(?:react-hot-loader|react-refresh)(?:\/|$)/;
const SNAPSHOT_OPAQUE_IMPORT_SYNTAX_PATTERN = /[:!?#\\]/;
const SNAPSHOT_JSX_TRANSFORM_PRAGMA_PATTERN = /@jsx(?:Frag|ImportSource|Runtime)?\b/;
const SNAPSHOT_TYPESCRIPT_MODULE_PATTERN = /\.[cm]?tsx?$/i;
const SNAPSHOT_FUNCTION_DECLARATION_SCOPE_KINDS = new Set(["module", "function", "arrow-function"]);

const getActiveSnapshotReferences = (
  symbol: SymbolDescriptor,
): ReadonlyArray<ReferenceDescriptor> =>
  symbol.references.filter(
    (reference) => !isClosedJsonSnapshotInactiveBranch(reference.identifier),
  );

const isClosedModuleHotReference = (identifier: EsTreeNode): boolean => {
  const hotMember = identifier.parent;
  if (
    hotMember?.type !== "MemberExpression" ||
    hotMember.object !== identifier ||
    hotMember.optional ||
    getStaticPropertyName(hotMember) !== "hot"
  )
    return false;
  {
    const accept = hotMember.parent;
    const call = accept?.parent;
    if (
      accept?.type === "MemberExpression" &&
      accept.object === hotMember &&
      !accept.optional &&
      getStaticPropertyName(accept) === "accept" &&
      call?.type === "CallExpression" &&
      call.callee === accept &&
      !call.optional
    )
      return call.arguments.every(
        (argument) =>
          isFunctionLike(argument) ||
          (argument.type === "Literal" && typeof argument.value === "string") ||
          (argument.type === "ArrayExpression" &&
            argument.elements.every(
              (element) => element?.type === "Literal" && typeof element.value === "string",
            )),
      );
  }
  let expression: EsTreeNode = hotMember;
  for (let depth = 0; depth < CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH; depth += 1) {
    const parent: EsTreeNode | null | undefined = expression.parent;
    if (!parent) return false;
    if (
      (parent.type === "IfStatement" || parent.type === "ConditionalExpression") &&
      parent.test === expression
    )
      return true;
    if (
      parent.type === "LogicalExpression" &&
      (parent.operator === "&&" || parent.operator === "||")
    ) {
      if (parent.left === expression) return true;
      expression = parent;
      continue;
    }
    if (
      parent.type === "UnaryExpression" &&
      parent.operator === "!" &&
      parent.argument === expression
    ) {
      expression = parent;
      continue;
    }
    if (
      parent.type === "BinaryExpression" &&
      ["===", "!==", "==", "!="].includes(parent.operator) &&
      ((parent.left === expression && parent.right.type === "Literal") ||
        (parent.right === expression && parent.left.type === "Literal"))
    ) {
      expression = parent;
      continue;
    }
    return false;
  }
  return false;
};

const isSupportedSnapshotJsxTag = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  project: ClosedJsonSnapshotProject,
  depth = 0,
): boolean => {
  if (depth > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) return false;
  const node = stripParenExpression(expression);
  const tagName = getStaticStringExpression(node);
  if (tagName !== null) return !SNAPSHOT_EXECUTABLE_JSX_TAG_NAMES.has(tagName.toLowerCase());
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "ClassExpression"
  )
    return true;
  if (node.type === "ConditionalExpression")
    return (
      isSupportedSnapshotJsxTag(node.consequent, module, project, depth + 1) &&
      isSupportedSnapshotJsxTag(node.alternate, module, project, depth + 1)
    );
  if (node.type === "JSXIdentifier" && (/^[a-z]/.test(node.name) || node.name.includes("-")))
    return !SNAPSHOT_EXECUTABLE_JSX_TAG_NAMES.has(node.name.toLowerCase());
  if (
    node.type !== "Identifier" &&
    node.type !== "JSXIdentifier" &&
    node.type !== "JSXMemberExpression" &&
    node.type !== "FunctionDeclaration" &&
    node.type !== "ClassDeclaration"
  )
    return false;
  const isDeclaration = node.type === "FunctionDeclaration" || node.type === "ClassDeclaration";
  if (isDeclaration && !node.id) return true;
  const bindingNode = isDeclaration
    ? node.id
    : node.type === "JSXMemberExpression"
      ? node.object
      : node;
  if (!bindingNode) return false;
  const symbol = module.scopes.symbolFor(bindingNode);
  if (!symbol) return false;
  const rootSymbol =
    bindingNode.type === "Identifier"
      ? module.scopes.rootScope.symbolsByName.get(bindingNode.name)
      : null;
  const symbols = new Set([symbol]);
  if (rootSymbol?.bindingIdentifier === bindingNode) symbols.add(rootSymbol);
  for (const currentSymbol of symbols) {
    if (
      currentSymbol.references.some((reference) => {
        if (reference.flag === "read") return false;
        const assignment = reference.identifier.parent;
        return (
          assignment?.type !== "AssignmentExpression" ||
          assignment.operator !== "=" ||
          assignment.left !== reference.identifier ||
          !isSupportedSnapshotJsxTag(assignment.right, module, project, depth + 1)
        );
      })
    )
      return false;
  }
  if (symbol.kind === "import") {
    const source = getImportSource(symbol);
    const imported = source ? project.resolveImport(module.filePath, source) : null;
    if (!imported) return Boolean(source && !source.startsWith(".") && !source.startsWith("/"));
    if (imported.program.type !== "Program") return false;
    const exportedName =
      node.type === "JSXMemberExpression"
        ? node.property.name
        : symbol.declarationNode.type === "ImportDefaultSpecifier"
          ? "default"
          : getImportedName(symbol.declarationNode);
    if (!exportedName) return false;
    for (const statement of imported.program.body) {
      if (statement.type === "ExportDefaultDeclaration" && exportedName === "default")
        return isSupportedSnapshotJsxTag(statement.declaration, imported, project, depth + 1);
    }
    const exported = findDirectExportSymbol(imported, exportedName);
    return Boolean(
      exported &&
      isSupportedSnapshotJsxTag(exported.bindingIdentifier, imported, project, depth + 1),
    );
  }
  const initializer = symbol.initializer;
  if (initializer && initializer !== node)
    return isSupportedSnapshotJsxTag(initializer, module, project, depth + 1);
  const declaration = symbol.declarationNode;
  if (
    declaration !== node &&
    (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration")
  )
    return isSupportedSnapshotJsxTag(declaration, module, project, depth + 1);
  return isDeclaration;
};

const isClosedClientIdentifier = (
  identifier: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  depth = 0,
): boolean => {
  if (identifier.type !== "Identifier" || depth > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH)
    return false;
  const symbol = module.scopes.symbolFor(identifier);
  if (!symbol) return false;
  if (symbol.kind === "import") return getImportSource(symbol) === "axios";
  const initializer = symbol.initializer;
  return (
    symbol.kind === "const" &&
    initializer?.type === "CallExpression" &&
    initializer.callee.type === "MemberExpression" &&
    getStaticPropertyName(initializer.callee) === "create" &&
    isClosedClientIdentifier(initializer.callee.object, module, depth + 1)
  );
};

const getSnapshotRequestArgumentValue = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  argument: SnapshotRequestArgument | undefined,
): EsTreeNode | null => {
  if (
    !argument ||
    expression.type !== "MemberExpression" ||
    expression.optional ||
    expression.computed ||
    expression.object.type !== "Identifier" ||
    module.scopes.symbolFor(expression.object) !== argument.parameter
  )
    return null;
  const propertyName = getStaticPropertyName(expression);
  const value = propertyName ? argument.properties.get(propertyName) : null;
  if (!value) return null;
  argument.references.add(expression.object);
  return value;
};

const isSnapshotPrimitiveLiteral = (node: EsTreeNode, requireFiniteNumbers = false): boolean =>
  node.type === "Literal" &&
  !("regex" in node) &&
  !("bigint" in node) &&
  (node.value === null ||
    typeof node.value === "string" ||
    typeof node.value === "boolean" ||
    (typeof node.value === "number" && (!requireFiniteNumbers || Number.isFinite(node.value))));

const isInertRequestValue = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  depth: number,
  allowContainers = true,
  argument?: SnapshotRequestArgument,
): boolean => {
  if (depth > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) return false;
  const node = stripParenExpression(expression);
  const argumentValue = getSnapshotRequestArgumentValue(node, module, argument);
  if (argumentValue && argument)
    return isInertRequestValue(argumentValue, argument.module, depth + 1);
  if (node.type === "Literal") return isSnapshotPrimitiveLiteral(node);
  if (node.type === "TemplateLiteral") return node.expressions.length === 0;
  if (node.type === "UnaryExpression" && ["-", "+", "!"].includes(node.operator)) {
    return isInertRequestValue(node.argument, module, depth + 1, true, argument);
  }
  if (node.type === "Identifier") {
    const symbol = module.scopes.symbolFor(node);
    return Boolean(
      symbol?.kind === "const" &&
      symbol.declarationNode.type === "VariableDeclarator" &&
      symbol.declarationNode.id === symbol.bindingIdentifier &&
      symbol.initializer &&
      getActiveSnapshotReferences(symbol).every(
        (reference) =>
          reference.flag === "read" &&
          [
            "Property",
            "ArrayExpression",
            "UnaryExpression",
            "ConditionalExpression",
            "BinaryExpression",
            "LogicalExpression",
          ].includes(reference.identifier.parent?.type ?? ""),
      ) &&
      isInertRequestValue(symbol.initializer, module, depth + 1, false, argument),
    );
  }
  if (node.type === "ArrayExpression") {
    if (!allowContainers) return false;
    return node.elements.every(
      (element) =>
        element && isInertRequestValue(element, module, depth + 1, allowContainers, argument),
    );
  }
  if (node.type === "ObjectExpression") {
    if (!allowContainers) return false;
    return node.properties.every(
      (property) =>
        property.type === "Property" &&
        property.kind === "init" &&
        !property.method &&
        getStaticPropertyKeyName(property) !== null &&
        getStaticPropertyKeyName(property) !== "__proto__" &&
        isInertRequestValue(property.value, module, depth + 1, allowContainers, argument),
    );
  }
  return false;
};

const isNodeEnvironmentRead = (node: EsTreeNode, module: ClosedJsonSnapshotModule): boolean =>
  node.type === "MemberExpression" &&
  getStaticPropertyName(node) === "NODE_ENV" &&
  node.object.type === "MemberExpression" &&
  getStaticPropertyName(node.object) === "env" &&
  node.object.object.type === "Identifier" &&
  node.object.object.name === "process" &&
  module.scopes.isGlobalReference(node.object.object);

const isInertTransportCondition = (
  node: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  depth: number,
): boolean => {
  if (depth > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) return false;
  if (isInertRequestValue(node, module, depth) || isNodeEnvironmentRead(node, module)) return true;
  if (node.type === "Identifier") {
    const symbol = module.scopes.symbolFor(node);
    return Boolean(
      symbol?.kind === "const" &&
      symbol.initializer &&
      symbol.declarationNode.type === "VariableDeclarator" &&
      symbol.declarationNode.id === symbol.bindingIdentifier &&
      getActiveSnapshotReferences(symbol).every((reference) => reference.flag === "read") &&
      isInertTransportCondition(symbol.initializer, module, depth + 1),
    );
  }
  if (node.type === "BinaryExpression" && ["===", "!=="].includes(node.operator)) {
    return (
      isInertTransportCondition(node.left, module, depth + 1) &&
      isInertTransportCondition(node.right, module, depth + 1)
    );
  }
  if (node.type === "LogicalExpression") {
    return (
      isInertTransportCondition(node.left, module, depth + 1) &&
      isInertTransportCondition(node.right, module, depth + 1)
    );
  }
  return (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    isInertTransportCondition(node.argument, module, depth + 1)
  );
};

const readRequestOptions = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  depth = 0,
  allowContainers = true,
  argument?: SnapshotRequestArgument,
  boundAlternatives = false,
): Map<string, EsTreeNode>[] | null => {
  if (depth > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) return null;
  const node = stripParenExpression(expression);
  if (node.type === "Identifier") {
    const symbol = module.scopes.symbolFor(node);
    if (argument && symbol === argument.parameter) {
      argument.references.add(node);
      return [new Map(argument.properties)];
    }
    if (
      symbol?.kind !== "const" ||
      symbol.declarationNode.type !== "VariableDeclarator" ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      symbol.declarationNode.parent?.parent?.type === "ExportNamedDeclaration" ||
      !symbol.initializer ||
      getActiveSnapshotReferences(symbol).some((reference) => {
        const parent = reference.identifier.parent;
        return (
          reference.flag !== "read" ||
          !parent ||
          (parent.type !== "SpreadElement" &&
            parent.type !== "ConditionalExpression" &&
            !(
              parent.type === "CallExpression" &&
              parent.arguments.some((argument) => argument === reference.identifier) &&
              (isClosedClientIdentifier(parent.callee, module) ||
                (parent.callee.type === "MemberExpression" &&
                  ["request", "create", "get"].includes(
                    getStaticPropertyName(parent.callee) ?? "",
                  ) &&
                  isClosedClientIdentifier(parent.callee.object, module)))
            ))
        );
      })
    ) {
      return null;
    }
    return readRequestOptions(
      symbol.initializer,
      module,
      depth + 1,
      false,
      argument,
      boundAlternatives,
    );
  }
  if (node.type === "ConditionalExpression") {
    if (!isInertTransportCondition(node.test, module, depth + 1)) return null;
    const consequent = readRequestOptions(
      node.consequent,
      module,
      depth + 1,
      allowContainers,
      argument,
      boundAlternatives,
    );
    const alternate = readRequestOptions(
      node.alternate,
      module,
      depth + 1,
      allowContainers,
      argument,
      boundAlternatives,
    );
    return consequent &&
      alternate &&
      (!(argument || boundAlternatives) ||
        consequent.length + alternate.length <= CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH)
      ? [...consequent, ...alternate]
      : null;
  }
  if (node.type !== "ObjectExpression") return null;
  let records: Map<string, EsTreeNode>[] = [new Map()];
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      const spreadRecords = readRequestOptions(
        property.argument,
        module,
        depth + 1,
        allowContainers,
        argument,
        boundAlternatives,
      );
      if (!spreadRecords) return null;
      const expandedRecords: Map<string, EsTreeNode>[] = [];
      for (const record of records) {
        for (const spreadRecord of spreadRecords) {
          expandedRecords.push(new Map([...record, ...spreadRecord]));
          if (expandedRecords.length > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) return null;
        }
      }
      records = expandedRecords;
      continue;
    }
    if (property.type !== "Property" || property.kind !== "init" || property.method) return null;
    const propertyName = getStaticPropertyKeyName(property);
    if (!propertyName || !REQUEST_OPTION_NAMES.has(propertyName)) return null;
    if (!isInertRequestValue(property.value, module, depth + 1, allowContainers, argument))
      return null;
    const value =
      getSnapshotRequestArgumentValue(property.value, module, argument) ?? property.value;
    for (const record of records) record.set(propertyName, value);
  }
  return records;
};

const hasClosedSnapshotRequestOptions = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  defaultsOnly = false,
  argument?: SnapshotRequestArgument,
  boundAlternatives = false,
  allowsDefaultResponse = false,
): boolean => {
  const records = readRequestOptions(expression, module, 0, true, argument, boundAlternatives);
  return Boolean(
    records &&
    records.every((record) => {
      if (defaultsOnly) return [...record.keys()].every((name) => CLIENT_DEFAULT_NAMES.has(name));
      const responseType = record.get("responseType");
      return (
        (responseType?.type === "Literal" && responseType.value === "json") ||
        (allowsDefaultResponse &&
          records.length <= CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH &&
          (!record.has("responseType") ||
            (responseType?.type === "Literal" && responseType.value === "text")))
      );
    }),
  );
};

const hasClosedSnapshotProviderPrelude = (
  declarations: ReadonlyArray<EsTreeNode>,
  request: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  argument?: SnapshotRequestArgument,
): boolean => {
  if (declarations.length === 0) return true;
  if (declarations.length > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT)
    return false;
  const recordBySymbol = new Map<SymbolDescriptor, boolean>();
  const approvedReferences = new Set<EsTreeNode>();
  const isPrimitive = (expression: EsTreeNode, depth = 0): boolean => {
    if (depth > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) return false;
    const node = stripParenExpression(expression);
    if (node.type === "Identifier") {
      const symbol = module.scopes.symbolFor(node);
      if (!symbol || recordBySymbol.get(symbol) !== false) return false;
      approvedReferences.add(node);
    } else if (node.type === "UnaryExpression" && ["-", "+", "!"].includes(node.operator)) {
      if (!isPrimitive(node.argument, depth + 1)) return false;
    } else if (
      node.type !== "Literal" &&
      !(node.type === "TemplateLiteral" && node.expressions.length === 0) &&
      !getSnapshotRequestArgumentValue(node, module, argument)
    )
      return false;
    return isInertRequestValue(node, module, depth, false, argument);
  };
  for (const declaration of declarations) {
    if (declaration.type !== "VariableDeclarator" || declaration.id.type !== "Identifier")
      return false;
    const symbol = module.scopes.symbolFor(declaration.id);
    if (!symbol || symbol.kind !== "const" || symbol.bindingIdentifier !== declaration.id)
      return false;
    const initializer = declaration.init && stripParenExpression(declaration.init);
    if (!initializer || initializer.type === "Identifier") return false;
    const isRecord = initializer.type === "ObjectExpression";
    if (isRecord) {
      for (const property of initializer.properties) {
        if (property.type === "SpreadElement") {
          const spread = stripParenExpression(property.argument);
          const spreadSymbol =
            spread.type === "Identifier" ? module.scopes.symbolFor(spread) : null;
          if (
            !spreadSymbol ||
            (recordBySymbol.get(spreadSymbol) !== true && spreadSymbol !== argument?.parameter)
          )
            return false;
          approvedReferences.add(spread);
          continue;
        }
        if (
          property.type !== "Property" ||
          property.kind !== "init" ||
          property.method ||
          !REQUEST_OPTION_NAMES.has(getStaticPropertyKeyName(property) ?? "") ||
          !isPrimitive(property.value)
        )
          return false;
        if (
          property.shorthand &&
          property.key.type === "Identifier" &&
          property.value.type === "Identifier" &&
          module.scopes.symbolFor(property.key) === module.scopes.symbolFor(property.value)
        )
          approvedReferences.add(property.key);
      }
      if (!readRequestOptions(initializer, module, 0, true, argument, true)) return false;
    } else if (!isPrimitive(initializer)) return false;
    recordBySymbol.set(symbol, isRecord);
  }
  walkAst(request, (node) => {
    approvedReferences.add(node);
  });
  return [...recordBySymbol.keys()].every((symbol) =>
    getActiveSnapshotReferences(symbol).every(
      (reference) => reference.flag === "read" && approvedReferences.has(reference.identifier),
    ),
  );
};

const getImportSource = (symbol: SymbolDescriptor): string | null => {
  return getImportDeclarationForSymbol(symbol)?.source.value ?? null;
};

const findDirectExportSymbol = (
  module: ClosedJsonSnapshotModule,
  exportedName: string,
): SymbolDescriptor | null => {
  if (module.program.type !== "Program") return null;
  for (const statement of module.program.body) {
    if (statement.type === "ExportDefaultDeclaration" && exportedName === "default") {
      return statement.declaration.type === "Identifier"
        ? module.scopes.symbolFor(statement.declaration)
        : null;
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.source) continue;
    if (
      (statement.declaration?.type === "FunctionDeclaration" ||
        statement.declaration?.type === "ClassDeclaration") &&
      statement.declaration.id?.name === exportedName
    )
      return module.scopes.symbolFor(statement.declaration.id);
    if (statement.declaration?.type === "VariableDeclaration") {
      for (const declaration of statement.declaration.declarations) {
        if (declaration.id.type === "Identifier" && declaration.id.name === exportedName) {
          return module.scopes.symbolFor(declaration.id);
        }
      }
    }
    for (const specifier of statement.specifiers) {
      const name =
        specifier.exported.type === "Identifier"
          ? specifier.exported.name
          : specifier.exported.value;
      if (name === exportedName) return module.scopes.symbolFor(specifier.local);
    }
  }
  return null;
};

const collectClientBindings = (
  project: ClosedJsonSnapshotProject,
): Map<SymbolDescriptor, SnapshotClientBinding> | null => {
  const clients = new Map<SymbolDescriptor, SnapshotClientBinding>();
  for (const module of project.modules.values()) {
    for (const symbol of module.scopes.rootScope.symbols) {
      if (getImportSource(symbol) !== "axios") continue;
      if (symbol.declarationNode.type !== "ImportDefaultSpecifier") return null;
      clients.set(symbol, { module, symbol, isAxios: true });
    }
  }
  for (let depth = 0; depth < CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH; depth++) {
    let didAddBinding = false;
    for (const module of project.modules.values()) {
      for (const symbol of module.scopes.rootScope.symbols) {
        if (clients.has(symbol)) continue;
        const initializer = symbol.initializer;
        if (
          symbol.kind === "const" &&
          initializer?.type === "CallExpression" &&
          initializer.callee.type === "MemberExpression" &&
          getStaticPropertyName(initializer.callee) === "create" &&
          initializer.callee.object.type === "Identifier" &&
          clients.get(module.scopes.symbolFor(initializer.callee.object)!)?.isAxios &&
          initializer.arguments.length <= 1 &&
          (!initializer.arguments[0] ||
            hasClosedSnapshotRequestOptions(initializer.arguments[0], module, true))
        ) {
          clients.set(symbol, { module, symbol, isAxios: false });
          didAddBinding = true;
        }
        const source = getImportSource(symbol);
        const declaration = symbol.declarationNode;
        if (!source || !["ImportSpecifier", "ImportDefaultSpecifier"].includes(declaration.type)) {
          continue;
        }
        const importedModule = project.resolveImport(module.filePath, source);
        if (!importedModule) {
          if (!source.startsWith(".") || CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN.test(source))
            continue;
          return null;
        }
        const importedName =
          declaration.type === "ImportDefaultSpecifier"
            ? "default"
            : declaration.type === "ImportSpecifier" && declaration.imported.type === "Identifier"
              ? declaration.imported.name
              : null;
        const exportedSymbol = importedName && findDirectExportSymbol(importedModule, importedName);
        const importedClient = exportedSymbol ? clients.get(exportedSymbol) : null;
        if (importedClient) {
          clients.set(symbol, { module, symbol, isAxios: importedClient.isAxios });
          didAddBinding = true;
        }
      }
    }
    if (!didAddBinding) return clients;
  }
  return null;
};

const isClientRequest = (
  call: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  clients: ReadonlyMap<SymbolDescriptor, SnapshotClientBinding>,
  argument?: SnapshotRequestArgument,
  boundAlternatives = false,
  allowsDefaultResponse = false,
): boolean => {
  if (call.type !== "CallExpression" || call.optional) return false;
  const callee = call.callee;
  if (callee.type === "Identifier") {
    const symbol = module.scopes.symbolFor(callee);
    return Boolean(
      symbol &&
      clients.has(symbol) &&
      call.arguments.length === 1 &&
      call.arguments[0] &&
      hasClosedSnapshotRequestOptions(
        call.arguments[0],
        module,
        false,
        argument,
        boundAlternatives,
        allowsDefaultResponse,
      ),
    );
  }
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return false;
  const symbol = module.scopes.symbolFor(callee.object);
  if (!symbol || !clients.has(symbol)) return false;
  const method = getStaticPropertyName(callee);
  if (method === "request") {
    return (
      call.arguments.length === 1 &&
      Boolean(call.arguments[0]) &&
      hasClosedSnapshotRequestOptions(
        call.arguments[0],
        module,
        false,
        argument,
        boundAlternatives,
        allowsDefaultResponse,
      )
    );
  }
  return (
    method === "get" &&
    call.arguments.length === 2 &&
    Boolean(call.arguments[0] && call.arguments[1]) &&
    isInertRequestValue(call.arguments[0], module, 0, true, argument) &&
    hasClosedSnapshotRequestOptions(
      call.arguments[1],
      module,
      false,
      argument,
      boundAlternatives,
      allowsDefaultResponse,
    )
  );
};

const hasClosedClientReferences = (
  project: ClosedJsonSnapshotProject,
  clients: ReadonlyMap<SymbolDescriptor, SnapshotClientBinding>,
  approvedRequest?: SnapshotApprovedRequest,
): boolean => {
  for (const { module, symbol, isAxios } of clients.values()) {
    const isPublicModule = isClosedJsonSnapshotPublicEntry({ project, filePath: module.filePath });
    if (
      isPublicModule &&
      module.program.type === "Program" &&
      module.program.body.some(
        (statement) =>
          statement.type === "ExportNamedDeclaration" &&
          statement.declaration?.type === "VariableDeclaration" &&
          statement.declaration.declarations.some(
            (declaration) => declaration.id === symbol.bindingIdentifier,
          ),
      )
    )
      return false;
    for (const reference of getActiveSnapshotReferences(symbol)) {
      const identifier = reference.identifier;
      const parent = identifier.parent;
      if (reference.flag !== "read" || !parent) return false;
      if (parent.type === "ExportSpecifier" || parent.type === "ExportDefaultDeclaration") {
        if (isPublicModule) return false;
        continue;
      }
      if (
        parent.type === "CallExpression" &&
        parent.callee === identifier &&
        ((approvedRequest?.module === module && approvedRequest.call === parent) ||
          isClientRequest(parent, module, clients))
      )
        continue;
      if (parent.type !== "MemberExpression" || parent.object !== identifier) return false;
      const propertyName = getStaticPropertyName(parent);
      const call = parent.parent;
      if (call?.type === "CallExpression" && call.callee === parent) {
        if (
          (approvedRequest?.module === module && approvedRequest.call === call) ||
          isClientRequest(call, module, clients)
        )
          continue;
        if (
          isAxios &&
          propertyName === "create" &&
          call.arguments.length <= 1 &&
          (!call.arguments[0] ||
            hasClosedSnapshotRequestOptions(call.arguments[0], module, true)) &&
          call.parent?.type === "VariableDeclarator" &&
          call.parent.id.type === "Identifier" &&
          clients.has(module.scopes.symbolFor(call.parent.id)!)
        )
          continue;
      }
      if (
        propertyName !== "defaults" ||
        call?.type !== "MemberExpression" ||
        call.object !== parent
      )
        return false;
      const defaultName = getStaticPropertyName(call);
      const assignment = call.parent;
      if (
        !defaultName ||
        !CLIENT_DEFAULT_NAMES.has(defaultName) ||
        assignment?.type !== "AssignmentExpression" ||
        assignment.left !== call ||
        assignment.operator !== "=" ||
        !isInertRequestValue(assignment.right, module, 0) ||
        assignment.parent?.type !== "ExpressionStatement" ||
        assignment.parent.parent !== module.program
      )
        return false;
    }
  }
  return true;
};

const hasClosedProviderGlobals = (
  project: ClosedJsonSnapshotProject,
  clients: ReadonlyMap<SymbolDescriptor, SnapshotClientBinding>,
): boolean => {
  const clientModulePaths = new Set([...clients.values()].map((client) => client.module.filePath));
  for (const module of project.modules.values()) {
    let hasBindingAmbiguity = false;
    walkAst(module.program, (node) => {
      if (
        node.type === "Identifier" &&
        SNAPSHOT_WEBPACK_MODULE_ARGUMENT_NAMES.has(node.name) &&
        module.scopes.symbolFor(node)
      )
        hasBindingAmbiguity = true;
      if (
        node.type === "FunctionDeclaration" &&
        !SNAPSHOT_FUNCTION_DECLARATION_SCOPE_KINDS.has(module.scopes.scopeFor(node).kind)
      )
        hasBindingAmbiguity = true;
    });
    if (hasBindingAmbiguity) return false;
    if (SNAPSHOT_TYPESCRIPT_MODULE_PATTERN.test(module.filePath)) return false;
    if (SNAPSHOT_JSX_TRANSFORM_PRAGMA_PATTERN.test(module.sourceText)) return false;
    if (!hasClosedJsonSnapshotTransformBindings(module)) return false;
    for (const symbol of module.scopes.rootScope.symbols) {
      const source = getImportSource(symbol);
      if (source === "react-router-dom") {
        if (
          symbol.declarationNode.type !== "ImportSpecifier" ||
          !hasClosedJsonSnapshotJsxReferences(symbol)
        )
          return false;
      }
      if (source === "antd") {
        const isNamespace = symbol.declarationNode.type !== "ImportSpecifier";
        if (
          (isNamespace || getImportedName(symbol.declarationNode) === "Carousel") &&
          !hasClosedJsonSnapshotJsxReferences(symbol, isNamespace)
        )
          return false;
      }
      if (
        source &&
        ["antd/lib", "antd/es"].some(
          (prefix) =>
            source === prefix || source === `${prefix}/index` || source === `${prefix}/index.js`,
        ) &&
        !hasClosedJsonSnapshotJsxReferences(
          symbol,
          symbol.declarationNode.type !== "ImportSpecifier",
        )
      )
        return false;
      if (
        source &&
        ["antd/lib/carousel", "antd/es/carousel"].some(
          (prefix) => source === prefix || source.startsWith(`${prefix}/`),
        ) &&
        (symbol.declarationNode.type !== "ImportDefaultSpecifier" ||
          !hasClosedJsonSnapshotJsxReferences(symbol))
      )
        return false;
      if (source === "lodash" || source === "lodash/isEmpty" || source === "lodash/isEmpty.js") {
        const importedName = getImportedName(symbol.declarationNode);
        const isNamespace =
          source === "lodash" &&
          (symbol.declarationNode.type !== "ImportSpecifier" || importedName === "default");
        if (source === "lodash" && !isNamespace && importedName !== "isEmpty") return false;
        if (
          source !== "lodash" &&
          symbol.declarationNode.type !== "ImportDefaultSpecifier" &&
          importedName !== "default"
        )
          return false;
        if (
          getActiveSnapshotReferences(symbol).some((reference) => {
            const parent = reference.identifier.parent;
            if (reference.flag !== "read") return true;
            if (!isNamespace)
              return !(parent?.type === "CallExpression" && parent.callee === reference.identifier);
            return !(
              parent?.type === "MemberExpression" &&
              parent.object === reference.identifier &&
              getStaticPropertyName(parent) === "isEmpty" &&
              parent.parent?.type === "CallExpression" &&
              parent.parent.callee === parent
            );
          })
        )
          return false;
      }
      if (source !== "react" && source !== "react-dom") continue;
      const importedName = getImportedName(symbol.declarationNode);
      const isNamespace =
        symbol.declarationNode.type !== "ImportSpecifier" || importedName === "default";
      const supportedApiNames =
        source === "react" ? SNAPSHOT_REACT_API_NAMES : SNAPSHOT_REACT_DOM_API_NAMES;
      if (
        !isNamespace &&
        (!importedName ||
          (!supportedApiNames.has(importedName) &&
            !(source === "react" && SNAPSHOT_SOURCE_REACT_COMPONENT_NAMES.has(importedName)) &&
            !(source === "react" && importedName === "Component")))
      )
        return false;
      if (
        getActiveSnapshotReferences(symbol).some((reference) => {
          if (reference.flag !== "read") return true;
          const parent = reference.identifier.parent;
          if (source === "react") {
            if (
              !isNamespace &&
              SNAPSHOT_SOURCE_REACT_COMPONENT_NAMES.has(importedName ?? "") &&
              (parent?.type === "JSXOpeningElement" || parent?.type === "JSXClosingElement") &&
              parent.name === reference.identifier
            )
              return false;
            if (
              isNamespace &&
              parent?.type === "JSXMemberExpression" &&
              parent.object === reference.identifier &&
              SNAPSHOT_SOURCE_REACT_COMPONENT_NAMES.has(parent.property.name)
            )
              return false;
            const childrenCall = parent?.parent?.parent;
            if (
              isNamespace &&
              parent?.type === "MemberExpression" &&
              parent.object === reference.identifier &&
              getStaticPropertyName(parent) === "Children" &&
              parent.parent?.type === "MemberExpression" &&
              parent.parent.object === parent &&
              ["only", "toArray", "map", "forEach", "count"].includes(
                getStaticPropertyName(parent.parent) ?? "",
              ) &&
              childrenCall?.type === "CallExpression" &&
              childrenCall.callee === parent.parent
            )
              return false;
          }
          if (source === "react") {
            const superclass =
              isNamespace &&
              parent?.type === "MemberExpression" &&
              parent.object === reference.identifier &&
              !parent.computed &&
              !parent.optional &&
              getStaticPropertyName(parent) === "Component"
                ? parent
                : !isNamespace && importedName === "Component"
                  ? reference.identifier
                  : null;
            const classNode = superclass?.parent;
            if (
              classNode &&
              (classNode.type === "ClassDeclaration" || classNode.type === "ClassExpression") &&
              classNode.superClass === superclass
            )
              return false;
          }
          if (!isNamespace) {
            return (
              importedName === "Component" ||
              !(parent?.type === "CallExpression" && parent.callee === reference.identifier)
            );
          }
          const propertyName =
            parent?.type === "MemberExpression" ? getStaticPropertyName(parent) : null;
          return !(
            parent?.type === "MemberExpression" &&
            parent.object === reference.identifier &&
            (supportedApiNames.has(propertyName ?? "") ||
              (source === "react" &&
                (propertyName === "createElement" || propertyName === "cloneElement"))) &&
            parent.parent?.type === "CallExpression" &&
            parent.parent.callee === parent &&
            !(
              source === "react" &&
              propertyName === "createElement" &&
              parent.parent.arguments[0] &&
              !isSupportedSnapshotJsxTag(parent.parent.arguments[0], module, project)
            )
          );
        })
      )
        return false;
    }
    let isClosed = true;
    walkAst(module.program, (node) => {
      if (!isClosed) return false;
      if (isClosedJsonSnapshotInactiveBranch(node)) return false;
      if (node.type === "ThisExpression") {
        const classNode = findEnclosingClass(node);
        if (!classNode) isClosed = false;
      }
      if (
        node.type === "FunctionDeclaration" &&
        !SNAPSHOT_FUNCTION_DECLARATION_SCOPE_KINDS.has(module.scopes.scopeFor(node).kind)
      )
        isClosed = false;
      if (node.type === "TSImportEqualsDeclaration") isClosed = false;
      if (
        node.type === "JSXOpeningElement" &&
        !isSupportedSnapshotJsxTag(node.name, module, project)
      )
        isClosed = false;
      if (
        node.type === "JSXAttribute" &&
        node.name.type === "JSXIdentifier" &&
        SNAPSHOT_EXECUTABLE_JSX_ATTRIBUTE_NAMES.has(node.name.name)
      )
        isClosed = false;
      if (node.type === "MemberExpression") {
        const staticName = getStaticPropertyName(node);
        const propertyNames =
          staticName === null && node.computed
            ? getFiniteStaticStringValues(node.property, {
                scopes: module.scopes,
                maximumExpressions: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH,
              })
            : [staticName ?? ""];
        if (
          [...propertyNames].some(
            (propertyName) =>
              SNAPSHOT_SHARED_PROTOTYPE_NAMES.has(propertyName) ||
              (SNAPSHOT_GLOBAL_GATEWAY_NAMES.has(propertyName) &&
                !(
                  SNAPSHOT_SOURCE_EVENT_TARGET_NAMES.has(propertyName) &&
                  node.parent?.type === "MemberExpression" &&
                  node.parent.object === node &&
                  SNAPSHOT_SOURCE_EVENT_VALUE_NAMES.has(getStaticPropertyName(node.parent) ?? "") &&
                  !(
                    node.parent.parent?.type === "AssignmentExpression" &&
                    node.parent.parent.left === node.parent
                  ) &&
                  node.parent.parent?.type !== "UpdateExpression" &&
                  node.parent.parent?.type !== "UnaryExpression"
                )),
          ) ||
          (node.computed &&
            staticName === null &&
            !isPassiveValueUse({
              node,
              scopes: module.scopes,
              maximumDepth: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH,
            }))
        )
          isClosed = false;
      }
      if (
        node.type === "ObjectPattern" &&
        node.properties.some((property) => {
          if (property.type !== "Property") return false;
          const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
          const propertyNames = property.computed
            ? getFiniteStaticStringValues(property.key, {
                scopes: module.scopes,
                maximumExpressions: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH,
              })
            : [propertyName ?? ""];
          return (
            (property.computed && !propertyName) ||
            [...propertyNames].some(
              (name) =>
                SNAPSHOT_SHARED_PROTOTYPE_NAMES.has(name) ||
                SNAPSHOT_GLOBAL_GATEWAY_NAMES.has(name),
            )
          );
        })
      )
        isClosed = false;
      if (
        node.type === "ImportDeclaration" &&
        (node.source.value.startsWith("/") ||
          SNAPSHOT_OPAQUE_IMPORT_SYNTAX_PATTERN.test(node.source.value) ||
          SNAPSHOT_LIVE_HMR_SOURCE_PATTERN.test(node.source.value) ||
          (SNAPSHOT_BOOTSTRAP_PACKAGE_NAMES.has(node.source.value.split("/")[0]) &&
            node.specifiers.length !== 0) ||
          (node.source.value.startsWith("lodash/") &&
            node.source.value !== "lodash/isEmpty" &&
            node.source.value !== "lodash/isEmpty.js") ||
          ["axios/", "react/", "react-dom/", "react-router-dom/"].some((prefix) =>
            node.source.value.startsWith(prefix),
          ))
      ) {
        isClosed = false;
      }
      if (
        node.type === "ExportAllDeclaration" ||
        (node.type === "ExportNamedDeclaration" && node.source)
      ) {
        isClosed = false;
      }
      if (node.type === "ImportDeclaration") {
        const importedModule = project.resolveImport(module.filePath, node.source.value);
        if (
          node.source.value.startsWith(".") &&
          !importedModule &&
          !CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN.test(node.source.value)
        )
          isClosed = false;
        if (
          importedModule &&
          clientModulePaths.has(importedModule.filePath) &&
          node.specifiers.some((specifier) => specifier.type === "ImportNamespaceSpecifier")
        )
          isClosed = false;
      }
      if (node.type === "ImportExpression") isClosed = false;
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        module.scopes.isGlobalReference(node.callee)
      ) {
        if (!isClosedJsonSnapshotSideEffectRequire({ node, module, project })) isClosed = false;
      }
      if (node.type !== "Identifier" || !module.scopes.isGlobalReference(node)) return;
      if (SNAPSHOT_WEBPACK_RUNTIME_NAMES.has(node.name)) isClosed = false;
      if (
        node.name === "require" &&
        !isClosedJsonSnapshotSideEffectRequire({ node: node.parent ?? node, module, project })
      )
        isClosed = false;
      if (SNAPSHOT_NATIVE_TIMER_NAMES.has(node.name)) {
        const call = node.parent;
        if (
          call?.type !== "CallExpression" ||
          call.callee !== node ||
          !isFunctionLike(call.arguments[0])
        )
          isClosed = false;
      }
      if (
        [
          "eval",
          "Function",
          "Reflect",
          "parent",
          "top",
          "opener",
          "frames",
          "global",
          "event",
          "addEventListener",
        ].includes(node.name)
      )
        isClosed = false;
      if (node.name === "module" && !isClosedModuleHotReference(node)) isClosed = false;
      if (node.name === "process") {
        const environmentMember = node.parent;
        const valueMember = environmentMember?.parent;
        if (
          !valueMember ||
          !isNodeEnvironmentRead(valueMember, module) ||
          (valueMember.parent?.type === "AssignmentExpression" &&
            valueMember.parent.left === valueMember) ||
          valueMember.parent?.type === "UpdateExpression" ||
          valueMember.parent?.type === "UnaryExpression"
        )
          isClosed = false;
      }
      if (SNAPSHOT_NATIVE_GLOBAL_NAMES.has(node.name)) {
        const parent = node.parent;
        if (parent?.type === "MemberExpression" && parent.object === node) {
          const accessParent = parent.parent;
          const propertyName = getStaticPropertyName(parent);
          if (
            (node.name === "Object" &&
              (!propertyName || !SNAPSHOT_NATIVE_OBJECT_READS.has(propertyName))) ||
            (node.name === "Array" && propertyName !== "isArray") ||
            (node.name === "JSON" && !SNAPSHOT_NATIVE_JSON_METHODS.has(propertyName ?? "")) ||
            (node.name === "Symbol" && !SNAPSHOT_NATIVE_SYMBOL_METHODS.has(propertyName ?? "")) ||
            (node.name === "Promise" && !SNAPSHOT_NATIVE_PROMISE_METHODS.has(propertyName ?? "")) ||
            node.name === "XMLHttpRequest"
          )
            isClosed = false;
          if (!(accessParent?.type === "CallExpression" && accessParent.callee === parent))
            isClosed = false;
        } else if (!(parent?.type === "NewExpression" && parent.callee === node)) isClosed = false;
      }
      if (["globalThis", "window", "self"].includes(node.name)) {
        const parent = node.parent;
        if (
          parent?.type !== "MemberExpression" ||
          parent.object !== node ||
          !SNAPSHOT_BROWSER_API_NAMES.has(getStaticPropertyName(parent) ?? "") ||
          parent.parent?.type !== "CallExpression" ||
          parent.parent.callee !== parent
        )
          isClosed = false;
        if (
          parent?.type === "MemberExpression" &&
          SNAPSHOT_NATIVE_TIMER_NAMES.has(getStaticPropertyName(parent) ?? "")
        ) {
          const call = parent.parent;
          if (
            call?.type !== "CallExpression" ||
            call.callee !== parent ||
            !isFunctionLike(call.arguments[0])
          )
            isClosed = false;
        }
      }
      if (node.name === "document") {
        const member = node.parent;
        if (
          member?.type !== "MemberExpression" ||
          member.object !== node ||
          !SNAPSHOT_DOCUMENT_LOOKUP_NAMES.has(getStaticPropertyName(member) ?? "") ||
          member.parent?.type !== "CallExpression" ||
          member.parent.callee !== member
        )
          isClosed = false;
      }
    });
    if (!isClosed) return false;
  }
  return true;
};

export const isClosedJsonSnapshotProvider = ({
  project,
  module,
  helperFunction,
  decoderRole,
  allowsAxiosDefaultResponseSnapshot = false,
  invocation,
}: ClosedJsonSnapshotProviderInput): boolean => {
  if (decoderRole !== "browser-native-json") return false;
  if (!isFunctionLike(helperFunction) || helperFunction.async || helperFunction.generator)
    return false;
  let hasImplicitEscape = false;
  walkAst(helperFunction, (node) => {
    if (isClosedJsonSnapshotInactiveBranch(node)) return false;
    if (
      node.type === "Identifier" &&
      ["arguments", "eval"].includes(node.name) &&
      module.scopes.isGlobalReference(node)
    )
      hasImplicitEscape = true;
  });
  if (hasImplicitEscape) return false;
  let argument: SnapshotRequestArgument | undefined;
  if (invocation) {
    if (isClosedJsonSnapshotPublicEntry({ project, filePath: module.filePath })) return false;
    const parameter = helperFunction.params[0];
    const call = invocation.call;
    const options = call.type === "CallExpression" ? call.arguments[0] : null;
    if (
      helperFunction.params.length !== 1 ||
      parameter?.type !== "Identifier" ||
      call.type !== "CallExpression" ||
      call.optional ||
      call.arguments.length !== 1 ||
      options?.type !== "ObjectExpression"
    )
      return false;
    const parameterSymbol = module.scopes.symbolFor(parameter);
    if (!parameterSymbol) return false;
    const properties = new Map<string, EsTreeNode>();
    for (const property of options.properties) {
      if (
        property.type !== "Property" ||
        property.kind !== "init" ||
        property.method ||
        property.computed ||
        property.shorthand ||
        !isSnapshotPrimitiveLiteral(property.value)
      )
        return false;
      const propertyName = getStaticPropertyKeyName(property);
      if (!propertyName || !REQUEST_OPTION_NAMES.has(propertyName) || properties.has(propertyName))
        return false;
      properties.set(propertyName, property.value);
    }
    argument = {
      module: invocation.module,
      parameter: parameterSymbol,
      properties,
      references: new Set(),
    };
  }
  const clients = collectClientBindings(project);
  if (!clients?.size || !hasClosedProviderGlobals(project, clients)) return false;
  const helperBody = getClosedJsonSnapshotProviderBody(helperFunction.body, "ReturnStatement");
  const returned = getSingleReturnExpression(helperFunction) ?? helperBody?.terminal;
  if (
    returned?.type !== "NewExpression" ||
    returned.callee.type !== "Identifier" ||
    returned.callee.name !== "Promise" ||
    !module.scopes.isGlobalReference(returned.callee) ||
    returned.arguments.length !== 1
  )
    return false;
  const executor = returned.arguments[0];
  if (!isFunctionLike(executor) || executor.async || executor.body.type !== "BlockStatement")
    return false;
  const resolveParameter = executor.params[0];
  const rejectParameter = executor.params[1];
  if (resolveParameter?.type !== "Identifier" || executor.params.length > 2) return false;
  const resolveSymbol = module.scopes.symbolFor(resolveParameter);
  if (!resolveSymbol || getActiveSnapshotReferences(resolveSymbol).length !== 1) return false;
  const executorBody = getClosedJsonSnapshotProviderBody(executor.body, "ExpressionStatement");
  const getSettlement = (branch: EsTreeNode | null | undefined): EsTreeNode | null => {
    const settlement =
      branch?.type === "BlockStatement"
        ? branch.body.length === 1
          ? branch.body[0]
          : null
        : branch;
    if (settlement?.type === "ExpressionStatement") return settlement.expression;
    if (settlement?.type === "ReturnStatement") return settlement.argument;
    return null;
  };
  let chain = executorBody?.terminal ?? null;
  let rejectionHandler: EsTreeNode | null = null;
  let forwardingDeclaration: EsTreeNode | null = null;
  let forwardingRejectSymbol: SymbolDescriptor | null = null;
  if (
    chain?.type === "CallExpression" &&
    chain.callee.type === "MemberExpression" &&
    getStaticPropertyName(chain.callee) === "catch"
  ) {
    const catchArgument = chain.arguments[0];
    if (chain.arguments.length !== 1 || rejectParameter?.type !== "Identifier") return false;
    const rejectSymbol = module.scopes.symbolFor(rejectParameter);
    if (
      catchArgument?.type === "Identifier" &&
      module.scopes.symbolFor(catchArgument) === rejectSymbol
    ) {
      rejectionHandler = catchArgument;
    } else {
      let forwardingHandler: EsTreeNode | undefined = catchArgument;
      if (catchArgument?.type === "Identifier") {
        const handlerSymbol = module.scopes.symbolFor(catchArgument);
        const declaration = handlerSymbol?.declarationNode;
        const references = handlerSymbol && getActiveSnapshotReferences(handlerSymbol);
        if (
          handlerSymbol?.kind !== "const" ||
          declaration?.type !== "VariableDeclarator" ||
          declaration.id !== handlerSymbol.bindingIdentifier ||
          declaration.parent?.type !== "VariableDeclaration" ||
          declaration.parent.parent !== executor.body ||
          !executorBody?.declarations.includes(declaration) ||
          references?.length !== 1 ||
          references[0]?.flag !== "read" ||
          references[0].identifier !== catchArgument
        )
          return false;
        forwardingDeclaration = declaration;
        forwardingHandler = declaration.init ?? undefined;
      }
      if (
        forwardingHandler?.type !== "ArrowFunctionExpression" ||
        forwardingHandler.async ||
        forwardingHandler.params.length !== 1 ||
        forwardingHandler.params[0]?.type !== "Identifier" ||
        !rejectSymbol ||
        rejectSymbol === resolveSymbol
      )
        return false;
      const errorSymbol = module.scopes.symbolFor(forwardingHandler.params[0]);
      const forwarding =
        forwardingHandler.body.type === "BlockStatement"
          ? getSettlement(forwardingHandler.body)
          : forwardingHandler.body;
      if (
        !errorSymbol ||
        forwarding?.type !== "CallExpression" ||
        forwarding.optional ||
        forwarding.callee.type !== "Identifier" ||
        module.scopes.symbolFor(forwarding.callee) !== rejectSymbol ||
        forwarding.arguments.length !== 1
      )
        return false;
      const error = forwarding.arguments[0];
      const errorReferences = getActiveSnapshotReferences(errorSymbol);
      if (
        error?.type !== "Identifier" ||
        module.scopes.symbolFor(error) !== errorSymbol ||
        errorReferences.length !== 1 ||
        errorReferences.some(
          (reference) => reference.flag !== "read" || reference.identifier !== error,
        )
      )
        return false;
      rejectionHandler = forwarding.callee;
      forwardingRejectSymbol = rejectSymbol;
    }
    chain = chain.callee.object;
  }
  const preludeDeclarations = [
    ...(helperBody?.declarations ?? []),
    ...(executorBody?.declarations ?? []),
  ];
  if (
    chain?.type !== "CallExpression" ||
    chain.callee.type !== "MemberExpression" ||
    getStaticPropertyName(chain.callee) !== "then" ||
    chain.arguments.length !== 1 ||
    preludeDeclarations.length > CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT ||
    !hasClosedSnapshotProviderPrelude(
      preludeDeclarations.filter((declaration) => declaration !== forwardingDeclaration),
      chain.callee.object,
      module,
      argument,
    ) ||
    !isClientRequest(
      chain.callee.object,
      module,
      clients,
      argument,
      Boolean(helperBody?.declarations.length || executorBody?.declarations.length),
      allowsAxiosDefaultResponseSnapshot,
    )
  )
    return false;
  const approvedRequest = { module, call: chain.callee.object };
  if (!hasClosedClientReferences(project, clients, approvedRequest)) return false;
  if (
    argument &&
    getActiveSnapshotReferences(argument.parameter).some(
      (reference) => reference.flag !== "read" || !argument?.references.has(reference.identifier),
    )
  )
    return false;
  const successCallback = chain.arguments[0];
  if (!isFunctionLike(successCallback) || successCallback.params.length !== 1) return false;
  const responseParameter = successCallback.params[0];
  if (responseParameter?.type !== "Identifier") return false;
  const responseSymbol = module.scopes.symbolFor(responseParameter);
  if (!responseSymbol) return false;
  const isResolution = (resolution: EsTreeNode | null): boolean => {
    if (
      resolution?.type !== "CallExpression" ||
      resolution.callee.type !== "Identifier" ||
      module.scopes.symbolFor(resolution.callee) !== resolveSymbol ||
      resolution.arguments.length !== 1
    )
      return false;
    const body = resolution.arguments[0];
    return (
      body?.type === "MemberExpression" &&
      !body.optional &&
      getStaticPropertyName(body) === "data" &&
      body.object.type === "Identifier" &&
      module.scopes.symbolFor(body.object) === responseSymbol
    );
  };
  const statement =
    successCallback.body.type === "BlockStatement" && successCallback.body.body.length === 1
      ? successCallback.body.body[0]
      : null;
  if (statement?.type === "IfStatement") {
    if (
      successCallback.async ||
      successCallback.generator ||
      rejectParameter?.type !== "Identifier"
    )
      return false;
    const rejectSymbol = module.scopes.symbolFor(rejectParameter);
    if (!rejectSymbol || rejectSymbol === resolveSymbol) return false;
    const isResponseStatus = (node: EsTreeNode): boolean =>
      node.type === "MemberExpression" &&
      !node.optional &&
      !node.computed &&
      getStaticPropertyName(node) === "status" &&
      node.object.type === "Identifier" &&
      module.scopes.symbolFor(node.object) === responseSymbol;
    const isNumericLiteral = (node: EsTreeNode): boolean =>
      node.type === "Literal" &&
      typeof node.value === "number" &&
      isSnapshotPrimitiveLiteral(node, true);
    const condition = statement.test;
    if (condition.type !== "BinaryExpression" || condition.operator !== "===") return false;
    const status =
      isResponseStatus(condition.left) && isNumericLiteral(condition.right)
        ? condition.left
        : isNumericLiteral(condition.left) && isResponseStatus(condition.right)
          ? condition.right
          : null;
    if (status?.type !== "MemberExpression") return false;
    const resolution = getSettlement(statement.consequent);
    const rejection = getSettlement(statement.alternate);
    if (
      resolution?.type !== "CallExpression" ||
      resolution.optional ||
      !isResolution(resolution) ||
      rejection?.type !== "CallExpression" ||
      rejection.optional ||
      rejection.callee.type !== "Identifier" ||
      module.scopes.symbolFor(rejection.callee) !== rejectSymbol ||
      rejection.arguments.length > 1
    )
      return false;
    const body = resolution.arguments[0];
    if (body?.type !== "MemberExpression") return false;
    const responseReferences = new Set<EsTreeNode>([status.object, body.object]);
    const reason = rejection.arguments[0];
    if (reason) {
      if (isResponseStatus(reason) && reason.type === "MemberExpression")
        responseReferences.add(reason.object);
      else if (!isSnapshotPrimitiveLiteral(reason, true)) return false;
    }
    const rejectReferences = new Set<EsTreeNode>([rejection.callee]);
    if (rejectionHandler) rejectReferences.add(rejectionHandler);
    return (
      getActiveSnapshotReferences(responseSymbol).every(
        (reference) => reference.flag === "read" && responseReferences.has(reference.identifier),
      ) &&
      getActiveSnapshotReferences(resolveSymbol).every(
        (reference) => reference.flag === "read" && reference.identifier === resolution.callee,
      ) &&
      getActiveSnapshotReferences(rejectSymbol).every(
        (reference) => reference.flag === "read" && rejectReferences.has(reference.identifier),
      )
    );
  }
  if (getActiveSnapshotReferences(responseSymbol).length !== 1) return false;
  let resolution: EsTreeNode | null = null;
  if (successCallback.body.type !== "BlockStatement") resolution = successCallback.body;
  else {
    if (statement?.type === "ExpressionStatement") resolution = statement.expression;
    if (statement?.type === "ReturnStatement") resolution = statement.argument;
  }
  return (
    isResolution(resolution) &&
    (!forwardingRejectSymbol ||
      getActiveSnapshotReferences(forwardingRejectSymbol).every(
        (reference) => reference.flag === "read" && reference.identifier === rejectionHandler,
      ))
  );
};
