import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { OBJECT_PROTOTYPE_PROPERTY_NAMES } from "../../../utils/constants.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getFiniteStaticStringValues } from "../../../utils/get-finite-static-string-values.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getOwnDataObjectProperties } from "../../../utils/get-own-data-object-properties.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  OWNED_CSS_RECORD_EMPTY_COUNT,
  OWNED_CSS_RECORD_SINGLE_COUNT,
  OWNED_CSS_RECORD_PAIR_COUNT,
  OWNED_CSS_RECORD_FIRST_INDEX,
  OWNED_CSS_RECORD_SECOND_INDEX,
  OWNED_CSS_RECORD_MAX_RESOLUTION_DEPTH,
  OWNED_CSS_RECORD_ZERO_VALUE,
  OWNED_INPUT_CALLABLE_GLOBAL_NAMES,
  OWNED_INPUT_NATIVE_ARRAY_METHOD_NAMES,
  OWNED_INPUT_NATIVE_STRING_METHOD_NAMES,
} from "./constants.js";

export interface ReadonlyCssCallableRecordUseInput {
  readonly lookup: EsTreeNode;
  readonly module: SourceProjectModule;
  readonly index: SourceProjectIndex;
}

interface CssRecordBinding {
  readonly symbol: SymbolDescriptor;
  readonly module: SourceProjectModule;
}

interface CssRecordOrigin {
  readonly value: EsTreeNode;
  readonly module: SourceProjectModule;
  readonly bindings: ReadonlyArray<CssRecordBinding>;
}

const hasAllowedReads = (binding: CssRecordBinding, allowed: ReadonlySet<EsTreeNode>): boolean =>
  hasOnlyAllowedSymbolReads({
    symbol: binding.symbol,
    scopes: binding.module.scopes,
    program: binding.module.programNode,
    allowedIdentifiers: new Set([
      ...allowed,
      ...binding.symbol.references
        .filter((reference) => isTypeScriptTypePosition(reference.identifier))
        .map((reference) => reference.identifier),
    ]),
  });

const hasReadonlyBinding = (binding: CssRecordBinding): boolean =>
  hasAllowedReads(
    binding,
    new Set(binding.symbol.references.map((reference) => reference.identifier)),
  );

const isGlobalObjectCall = (
  rawCall: EsTreeNode,
  name: string,
  module: SourceProjectModule,
): boolean => {
  const call = stripParenExpression(rawCall);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== OWNED_CSS_RECORD_SINGLE_COUNT
  )
    return false;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getResolvedStaticPropertyName(callee, module.scopes) !== name
  )
    return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Object" &&
    module.scopes.isGlobalReference(receiver)
  );
};

export const isReadonlyCssCallableRecordUse = ({
  lookup: rawLookup,
  module,
  index,
}: ReadonlyCssCallableRecordUseInput): boolean => {
  const lookup = stripParenExpression(rawLookup);
  if (!isNodeOfType(lookup, "MemberExpression") || lookup.optional || !lookup.computed)
    return false;
  const hasReservedKey = (member: EsTreeNode, owner: SourceProjectModule): boolean => {
    if (!isNodeOfType(member, "MemberExpression")) return true;
    const names = member.computed
      ? getFiniteStaticStringValues(member.property, { scopes: owner.scopes })
      : new Set([getResolvedStaticPropertyName(member, owner.scopes)]);
    return [...names].some(
      (name) =>
        name === "prototype" || (name !== null && OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)),
    );
  };
  if (hasReservedKey(lookup, module)) return false;

  const isVisiblyCallable = (
    rawValue: EsTreeNode,
    owner: SourceProjectModule,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = stripParenExpression(rawValue);
    if (resolveExactLocalFunction(value, owner.scopes)) return true;
    if (isNodeOfType(value, "Identifier")) {
      if (
        owner.scopes.isGlobalReference(value) &&
        OWNED_INPUT_CALLABLE_GLOBAL_NAMES.has(value.name)
      )
        return true;
      const symbol = owner.scopes.symbolFor(value);
      if (!symbol || visited.has(symbol)) return false;
      if (!hasReadonlyBinding({ symbol, module: owner })) return true;
      if (getValueImportDeclaration(symbol)) return true;
      visited.add(symbol);
      const initializer = getDirectUnreassignedInitializer(symbol);
      return Boolean(initializer && isVisiblyCallable(initializer, owner, visited));
    }
    if (isNodeOfType(value, "ArrayExpression"))
      return value.elements.some(
        (element) =>
          element &&
          isVisiblyCallable(
            isNodeOfType(element, "SpreadElement") ? element.argument : element,
            owner,
            new Set(visited),
          ),
      );
    if (isNodeOfType(value, "ObjectExpression"))
      return value.properties.some((property) =>
        isNodeOfType(property, "SpreadElement")
          ? isVisiblyCallable(property.argument, owner, new Set(visited))
          : isNodeOfType(property, "Property") &&
            isVisiblyCallable(property.value, owner, new Set(visited)),
      );
    if (isNodeOfType(value, "LogicalExpression"))
      return (
        isVisiblyCallable(value.left, owner, new Set(visited)) ||
        isVisiblyCallable(value.right, owner, new Set(visited))
      );
    if (isNodeOfType(value, "ConditionalExpression"))
      return (
        isVisiblyCallable(value.consequent, owner, new Set(visited)) ||
        isVisiblyCallable(value.alternate, owner, new Set(visited))
      );
    if (isNodeOfType(value, "SequenceExpression")) {
      const last = value.expressions.at(-OWNED_CSS_RECORD_SINGLE_COUNT);
      return Boolean(last && isVisiblyCallable(last, owner, visited));
    }
    if (isNodeOfType(value, "MemberExpression") && !value.optional) {
      let receiver = stripParenExpression(value.object);
      while (isNodeOfType(receiver, "Identifier")) {
        const symbol = owner.scopes.symbolFor(receiver);
        if (!symbol || visited.has(symbol) || !hasReadonlyBinding({ symbol, module: owner })) break;
        visited.add(symbol);
        const initializer = getDirectUnreassignedInitializer(symbol);
        if (!initializer) break;
        receiver = stripParenExpression(initializer);
      }
      const name = getResolvedStaticPropertyName(value, owner.scopes);
      if (!name) return false;
      if (isNodeOfType(receiver, "Identifier") && owner.scopes.isGlobalReference(receiver))
        return true;
      if (isNodeOfType(receiver, "ArrayExpression"))
        return OWNED_INPUT_NATIVE_ARRAY_METHOD_NAMES.has(name);
      if (isNodeOfType(receiver, "Literal"))
        return typeof receiver.value === "string"
          ? OWNED_INPUT_NATIVE_STRING_METHOD_NAMES.has(name)
          : receiver.value !== null || "regex" in receiver;
    }
    return false;
  };

  const resolveOrigin = (
    rawValue: EsTreeNode,
    owner: SourceProjectModule,
    visited = new Set<SymbolDescriptor>(),
    depth = OWNED_CSS_RECORD_EMPTY_COUNT,
  ): CssRecordOrigin | null => {
    if (depth > OWNED_CSS_RECORD_MAX_RESOLUTION_DEPTH) return null;
    const value = stripParenExpression(rawValue);
    if (isFunctionLike(value) || isNodeOfType(value, "ObjectExpression"))
      return { value, module: owner, bindings: [] };
    if (!isNodeOfType(value, "Identifier")) return null;
    const symbol = owner.scopes.symbolFor(value);
    if (!symbol || visited.has(symbol) || !hasReadonlyBinding({ symbol, module: owner }))
      return null;
    visited.add(symbol);
    const declaration = getValueImportDeclaration(symbol);
    if (declaration && isNodeOfType(declaration, "ImportDeclaration")) {
      if (!declaration.source.value.startsWith(".")) return null;
      const name = isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
        ? "default"
        : getImportedName(symbol.declarationNode);
      const exported = name
        ? resolveCrossFileValueExportWithFilePath(owner.filePath, declaration.source.value, name, {
            requireCompleteReexports: true,
          })
        : null;
      const target = exported ? index.modulesByFilePath.get(exported.filePath) : undefined;
      if (!exported || !target || target.programNode !== exported.programNode) return null;
      const root = findTransparentExpressionRoot(exported.exportedNode);
      const parent = root.parent;
      const identifier =
        isNodeOfType(exported.exportedNode, "FunctionDeclaration") && exported.exportedNode.id
          ? exported.exportedNode.id
          : isNodeOfType(parent, "VariableDeclarator") &&
              parent.init === root &&
              isNodeOfType(parent.id, "Identifier")
            ? parent.id
            : exported.exportedNode;
      const resolved = resolveOrigin(
        identifier,
        target,
        visited,
        depth + OWNED_CSS_RECORD_SINGLE_COUNT,
      );
      return resolved
        ? { ...resolved, bindings: [...resolved.bindings, { symbol, module: owner }] }
        : null;
    }
    const initializer =
      symbol.kind === "function"
        ? symbol.declarationNode
        : getDirectUnreassignedInitializer(symbol);
    const resolved = initializer
      ? resolveOrigin(initializer, owner, visited, depth + OWNED_CSS_RECORD_SINGLE_COUNT)
      : null;
    return resolved
      ? { ...resolved, bindings: [...resolved.bindings, { symbol, module: owner }] }
      : null;
  };

  const hasClosedCallableUses = (
    rawValue: EsTreeNode,
    owner: SourceProjectModule,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = findTransparentExpressionRoot(rawValue);
    const parent = value.parent;
    if (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === value)
      return parent.quasi.expressions.every(
        (expression) =>
          !isVisiblyCallable(expression, owner) || isStyleFunction(expression, owner, parent),
      );
    if (isNodeOfType(parent, "CallExpression") && !parent.optional && parent.callee === value) {
      if (parent.arguments.length === OWNED_CSS_RECORD_EMPTY_COUNT) return true;
      if (parent.arguments.length !== OWNED_CSS_RECORD_SINGLE_COUNT) return false;
      const fields = getOwnDataObjectProperties(
        stripParenExpression(parent.arguments[OWNED_CSS_RECORD_FIRST_INDEX]),
      );
      return Boolean(
        fields &&
        [...fields].every(
          ([name, field]) =>
            !OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) &&
            name !== "prototype" &&
            !isVisiblyCallable(field, owner),
        ),
      );
    }
    if (
      !isNodeOfType(parent, "VariableDeclarator") ||
      parent.init !== value ||
      !isNodeOfType(parent.id, "Identifier")
    )
      return false;
    const symbol = owner.scopes.symbolFor(parent.id);
    if (!symbol || !hasReadonlyBinding({ symbol, module: owner })) return false;
    if (visited.has(symbol)) return true;
    visited.add(symbol);
    return symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        hasClosedCallableUses(reference.identifier, owner, new Set(visited)),
    );
  };

  const hasClosedRecordUses = (
    rawValue: EsTreeNode,
    owner: SourceProjectModule,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = findTransparentExpressionRoot(rawValue);
    const parent = value.parent;
    if (isNodeOfType(parent, "MemberExpression") && !parent.optional && parent.object === value) {
      if (hasReservedKey(parent, owner)) return false;
      return hasClosedCallableUses(parent, owner);
    }
    if (
      !isNodeOfType(parent, "VariableDeclarator") ||
      parent.init !== value ||
      !isNodeOfType(parent.id, "Identifier")
    )
      return false;
    const symbol = owner.scopes.symbolFor(parent.id);
    if (!symbol || !hasReadonlyBinding({ symbol, module: owner })) return false;
    if (visited.has(symbol)) return true;
    visited.add(symbol);
    return symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        hasClosedRecordUses(reference.identifier, owner, new Set(visited)),
    );
  };

  const hasClosedOriginBindings = (
    origin: CssRecordOrigin,
    permitted: (value: EsTreeNode, owner: SourceProjectModule) => boolean,
  ): boolean => {
    const bindings = new Map(origin.bindings.map((binding) => [binding.symbol, binding]));
    const reexportsOrigin = (owner: SourceProjectModule, visited = new Set<string>()): boolean => {
      if (owner === origin.module) return true;
      if (visited.has(owner.filePath)) return false;
      visited.add(owner.filePath);
      return owner.programNode.body.some((statement) => {
        if (
          (!isNodeOfType(statement, "ExportAllDeclaration") &&
            !isNodeOfType(statement, "ExportNamedDeclaration")) ||
          statement.exportKind === "type" ||
          !statement.source
        )
          return false;
        const targetPath = index.resolvedSourcePathByNode.get(statement);
        const target = targetPath ? index.modulesByFilePath.get(targetPath) : undefined;
        return Boolean(target && reexportsOrigin(target, new Set(visited)));
      });
    };
    for (const candidate of index.modulesByFilePath.values()) {
      for (const statement of candidate.programNode.body) {
        if (
          !isNodeOfType(statement, "ImportDeclaration") ||
          statement.importKind === "type" ||
          !statement.source.value.startsWith(".")
        )
          continue;
        for (const specifier of statement.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            const targetPath = index.resolvedSourcePathByNode.get(statement);
            const target = targetPath ? index.modulesByFilePath.get(targetPath) : undefined;
            if (!target || reexportsOrigin(target)) return false;
            continue;
          }
          const resolved = resolveOrigin(specifier.local, candidate);
          if (resolved?.value === origin.value)
            for (const binding of resolved.bindings) bindings.set(binding.symbol, binding);
        }
      }
    }
    for (const binding of bindings.values()) {
      if (!hasReadonlyBinding(binding)) return false;
      for (const reference of binding.symbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (
          isNodeOfType(parent, "ExportSpecifier") ||
          isNodeOfType(parent, "ExportDefaultDeclaration")
        )
          continue;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const next = binding.module.scopes.symbolFor(parent.id);
          if (
            next &&
            getDirectUnreassignedInitializer(next) === value &&
            hasReadonlyBinding({ symbol: next, module: binding.module })
          ) {
            bindings.set(next, { symbol: next, module: binding.module });
            continue;
          }
        }
        if (!permitted(value, binding.module)) return false;
      }
    }
    return true;
  };

  const isCanonicalCssTag = (rawTag: EsTreeNode, owner: SourceProjectModule): boolean => {
    const tag = stripParenExpression(rawTag);
    const symbol = isNodeOfType(tag, "Identifier") ? owner.scopes.symbolFor(tag) : null;
    const declaration = symbol ? getValueImportDeclaration(symbol) : null;
    if (
      !symbol ||
      !declaration ||
      !isNodeOfType(declaration, "ImportDeclaration") ||
      declaration.source.value !== "styled-components" ||
      getImportedName(symbol.declarationNode) !== "css" ||
      !hasReadonlyBinding({ symbol, module: owner })
    )
      return false;
    return symbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const value = findTransparentExpressionRoot(reference.identifier);
      const parent = value.parent;
      return (
        (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === value) ||
        (isNodeOfType(parent, "CallExpression") && parent.callee === value && !parent.optional)
      );
    });
  };

  const isDataParameter = (parameter: EsTreeNode): boolean => {
    if (isNodeOfType(parameter, "Identifier")) return true;
    return (
      isNodeOfType(parameter, "ObjectPattern") &&
      parameter.properties.every((property) => {
        if (
          !isNodeOfType(property, "Property") ||
          property.computed ||
          property.method ||
          property.kind !== "init"
        )
          return false;
        const name = getResolvedStaticPropertyName(property, module.scopes);
        return (
          name !== "prototype" &&
          (name === null || !OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)) &&
          isDataParameter(property.value)
        );
      })
    );
  };

  const isStyleFunction = (
    rawValue: EsTreeNode,
    owner: SourceProjectModule,
    record: EsTreeNode,
  ): boolean => {
    const origin = resolveOrigin(rawValue, owner);
    if (
      !origin ||
      !isFunctionLike(origin.value) ||
      origin.value.async ||
      origin.value.generator ||
      origin.value.params.length > OWNED_CSS_RECORD_SINGLE_COUNT
    )
      return false;
    if (
      origin.value.params.some(
        (parameter) => !isNodeOfType(parameter, "ObjectPattern") || !isDataParameter(parameter),
      )
    )
      return false;
    let returned: EsTreeNode | null = getSingleReturnExpression(origin.value);
    if (isNodeOfType(origin.value.body, "BlockStatement")) {
      const statements = origin.value.body.body;
      const last = statements.at(-OWNED_CSS_RECORD_SINGLE_COUNT);
      if (
        !isNodeOfType(last, "ReturnStatement") ||
        !last.argument ||
        !statements
          .slice(OWNED_CSS_RECORD_EMPTY_COUNT, -OWNED_CSS_RECORD_SINGLE_COUNT)
          .every(
            (statement) =>
              isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const",
          )
      )
        return false;
      returned = last.argument;
    }
    if (!returned) return false;
    const result = stripParenExpression(returned);
    if (
      !(
        isNodeOfType(result, "TemplateLiteral") ||
        (isNodeOfType(result, "Literal") && typeof result.value === "string") ||
        (isNodeOfType(result, "TaggedTemplateExpression") &&
          isCanonicalCssTag(result.tag, origin.module))
      )
    )
      return false;
    if (
      isNodeOfType(result, "TaggedTemplateExpression") &&
      result.quasi.expressions.some((expression) => isVisiblyCallable(expression, origin.module))
    )
      return false;
    return hasClosedOriginBindings(origin, (value, consumer) => {
      const parent = value.parent;
      const isOwnField =
        isNodeOfType(parent, "Property") &&
        parent.parent === record &&
        parent.value === value &&
        !parent.computed &&
        !parent.method &&
        parent.kind === "init";
      const isOwnInterpolation =
        isNodeOfType(record, "TaggedTemplateExpression") &&
        parent === record.quasi &&
        record.quasi.expressions.some(
          (expression) => findTransparentExpressionRoot(expression) === value,
        );
      return consumer === owner && (isOwnField || isOwnInterpolation);
    });
  };

  const isLiteralStyleRecord = (rawRecord: EsTreeNode, owner: SourceProjectModule): boolean => {
    const record = stripParenExpression(rawRecord);
    const fields = getOwnDataObjectProperties(record);
    return Boolean(
      fields &&
      fields.size > OWNED_CSS_RECORD_EMPTY_COUNT &&
      [...fields].every(
        ([name, value]) =>
          name !== "prototype" &&
          !OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) &&
          isStyleFunction(value, owner, record),
      ),
    );
  };

  const isReducedStyleRecord = (origin: CssRecordOrigin): boolean => {
    if (
      !isFunctionLike(origin.value) ||
      origin.value.async ||
      origin.value.generator ||
      origin.value.params.length !== OWNED_CSS_RECORD_SINGLE_COUNT
    )
      return false;
    const owner = origin.module;
    const input = origin.value.params[OWNED_CSS_RECORD_FIRST_INDEX];
    const reduced = stripParenExpression(getSingleReturnExpression(origin.value) ?? origin.value);
    if (
      !isNodeOfType(input, "Identifier") ||
      !isNodeOfType(reduced, "CallExpression") ||
      reduced.optional ||
      reduced.arguments.length !== OWNED_CSS_RECORD_PAIR_COUNT
    )
      return false;
    const reducerCallee = stripParenExpression(reduced.callee);
    if (
      !isNodeOfType(reducerCallee, "MemberExpression") ||
      reducerCallee.optional ||
      getResolvedStaticPropertyName(reducerCallee, owner.scopes) !== "reduce"
    )
      return false;
    const keysCall = stripParenExpression(reducerCallee.object);
    if (!isNodeOfType(keysCall, "CallExpression") || !isGlobalObjectCall(keysCall, "keys", owner))
      return false;
    const keysInput = stripParenExpression(keysCall.arguments[OWNED_CSS_RECORD_FIRST_INDEX]);
    const inputSymbol = owner.scopes.symbolFor(input);
    if (
      !inputSymbol ||
      !isNodeOfType(keysInput, "Identifier") ||
      owner.scopes.symbolFor(keysInput) !== inputSymbol
    )
      return false;
    const reducer = stripParenExpression(reduced.arguments[OWNED_CSS_RECORD_FIRST_INDEX]);
    const seed = stripParenExpression(reduced.arguments[OWNED_CSS_RECORD_SECOND_INDEX]);
    if (
      !isFunctionLike(reducer) ||
      reducer.async ||
      reducer.generator ||
      reducer.params.length !== OWNED_CSS_RECORD_PAIR_COUNT ||
      !isNodeOfType(reducer.body, "BlockStatement") ||
      reducer.body.body.length !== OWNED_CSS_RECORD_PAIR_COUNT ||
      !isNodeOfType(seed, "ObjectExpression") ||
      seed.properties.length !== OWNED_CSS_RECORD_EMPTY_COUNT
    )
      return false;
    const accumulator = reducer.params[OWNED_CSS_RECORD_FIRST_INDEX];
    const label = reducer.params[OWNED_CSS_RECORD_SECOND_INDEX];
    const assignmentStatement = reducer.body.body[OWNED_CSS_RECORD_FIRST_INDEX];
    const returned = reducer.body.body[OWNED_CSS_RECORD_SECOND_INDEX];
    if (
      !isNodeOfType(accumulator, "Identifier") ||
      !isNodeOfType(label, "Identifier") ||
      !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
      !isNodeOfType(returned, "ReturnStatement") ||
      !returned.argument
    )
      return false;
    const assignment = stripParenExpression(assignmentStatement.expression);
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !isNodeOfType(assignment.left, "MemberExpression") ||
      !assignment.left.computed ||
      assignment.left.optional
    )
      return false;
    const accumulatorUse = stripParenExpression(assignment.left.object);
    const labelUse = stripParenExpression(assignment.left.property);
    const returnedAccumulator = stripParenExpression(returned.argument);
    const accumulatorSymbol = owner.scopes.symbolFor(accumulator);
    const labelSymbol = owner.scopes.symbolFor(label);
    if (
      !accumulatorSymbol ||
      !labelSymbol ||
      !isNodeOfType(accumulatorUse, "Identifier") ||
      owner.scopes.symbolFor(accumulatorUse) !== accumulatorSymbol ||
      !isNodeOfType(labelUse, "Identifier") ||
      owner.scopes.symbolFor(labelUse) !== labelSymbol ||
      !isNodeOfType(returnedAccumulator, "Identifier") ||
      owner.scopes.symbolFor(returnedAccumulator) !== accumulatorSymbol
    )
      return false;
    const wrapper = stripParenExpression(assignment.right);
    if (
      !isNodeOfType(wrapper, "ArrowFunctionExpression") ||
      wrapper.async ||
      wrapper.params.length !== OWNED_CSS_RECORD_SINGLE_COUNT ||
      !isNodeOfType(wrapper.params[OWNED_CSS_RECORD_FIRST_INDEX], "RestElement")
    )
      return false;
    const rest = wrapper.params[OWNED_CSS_RECORD_FIRST_INDEX];
    if (!isNodeOfType(rest, "RestElement") || !isNodeOfType(rest.argument, "Identifier"))
      return false;
    const cssTagged = stripParenExpression(getSingleReturnExpression(wrapper) ?? wrapper);
    if (
      !isNodeOfType(cssTagged, "TaggedTemplateExpression") ||
      cssTagged.quasi.expressions.length !== OWNED_CSS_RECORD_PAIR_COUNT
    )
      return false;
    const cssIdentifier = stripParenExpression(cssTagged.tag);
    const cssSymbol = isNodeOfType(cssIdentifier, "Identifier")
      ? owner.scopes.symbolFor(cssIdentifier)
      : null;
    const cssImport = cssSymbol ? getValueImportDeclaration(cssSymbol) : null;
    if (
      !cssSymbol ||
      !cssImport ||
      !isNodeOfType(cssImport, "ImportDeclaration") ||
      cssImport.source.value !== "styled-components" ||
      getImportedName(cssSymbol.declarationNode) !== "css" ||
      !hasReadonlyBinding({ symbol: cssSymbol, module: owner })
    )
      return false;
    for (const reference of cssSymbol.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      const value = findTransparentExpressionRoot(reference.identifier);
      const parent = value.parent;
      if (
        (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === value) ||
        (isNodeOfType(parent, "CallExpression") && parent.callee === value && !parent.optional)
      )
        continue;
      return false;
    }
    const width = stripParenExpression(cssTagged.quasi.expressions[OWNED_CSS_RECORD_FIRST_INDEX]);
    const delegated = stripParenExpression(
      cssTagged.quasi.expressions[OWNED_CSS_RECORD_SECOND_INDEX],
    );
    if (
      !isNodeOfType(width, "LogicalExpression") ||
      width.operator !== "||" ||
      !isNodeOfType(width.right, "Literal") ||
      width.right.value !== OWNED_CSS_RECORD_ZERO_VALUE
    )
      return false;
    const widthRead = stripParenExpression(width.left);
    if (
      !isNodeOfType(widthRead, "MemberExpression") ||
      widthRead.optional ||
      getResolvedStaticPropertyName(widthRead, owner.scopes) !== "width"
    )
      return false;
    const breakpoint = stripParenExpression(widthRead.object);
    if (
      !isNodeOfType(breakpoint, "MemberExpression") ||
      breakpoint.optional ||
      !breakpoint.computed
    )
      return false;
    const breakpointInput = stripParenExpression(breakpoint.object);
    const breakpointLabel = stripParenExpression(breakpoint.property);
    if (
      !isNodeOfType(breakpointInput, "Identifier") ||
      owner.scopes.symbolFor(breakpointInput) !== inputSymbol ||
      !isNodeOfType(breakpointLabel, "Identifier") ||
      owner.scopes.symbolFor(breakpointLabel) !== labelSymbol
    )
      return false;
    if (
      !isNodeOfType(delegated, "CallExpression") ||
      delegated.optional ||
      delegated.arguments.length !== OWNED_CSS_RECORD_SINGLE_COUNT ||
      !isNodeOfType(stripParenExpression(delegated.callee), "Identifier") ||
      owner.scopes.symbolFor(stripParenExpression(delegated.callee)) !== cssSymbol
    )
      return false;
    const spread = delegated.arguments[OWNED_CSS_RECORD_FIRST_INDEX];
    if (!isNodeOfType(spread, "SpreadElement")) return false;
    const spreadValue = stripParenExpression(spread.argument);
    const restSymbol = owner.scopes.symbolFor(rest.argument);
    if (
      !restSymbol ||
      !isNodeOfType(spreadValue, "Identifier") ||
      owner.scopes.symbolFor(spreadValue) !== restSymbol
    )
      return false;
    if (
      !hasAllowedReads(
        { symbol: inputSymbol, module: owner },
        new Set([keysInput, breakpointInput]),
      ) ||
      !hasAllowedReads(
        { symbol: accumulatorSymbol, module: owner },
        new Set([accumulatorUse, returnedAccumulator]),
      ) ||
      !hasAllowedReads(
        { symbol: labelSymbol, module: owner },
        new Set([labelUse, breakpointLabel]),
      ) ||
      !hasAllowedReads({ symbol: restSymbol, module: owner }, new Set([spreadValue]))
    )
      return false;
    return true;
  };

  if (!hasClosedCallableUses(lookup, module)) return false;
  let receiver = stripParenExpression(lookup.object);
  const receiverAliases = new Set<SymbolDescriptor>();
  while (isNodeOfType(receiver, "Identifier")) {
    const symbol = module.scopes.symbolFor(receiver);
    if (!symbol || receiverAliases.has(symbol) || !hasReadonlyBinding({ symbol, module })) break;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) break;
    const next = stripParenExpression(initializer);
    if (!isNodeOfType(next, "Identifier") && !isNodeOfType(next, "CallExpression")) break;
    receiverAliases.add(symbol);
    receiver = next;
  }
  if (isNodeOfType(receiver, "CallExpression")) {
    if (
      receiver.optional ||
      receiver.arguments.length > OWNED_CSS_RECORD_SINGLE_COUNT ||
      receiver.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return false;
    const origin = resolveOrigin(receiver.callee, module);
    if (
      !origin ||
      !isFunctionLike(origin.value) ||
      origin.value.async ||
      origin.value.generator ||
      origin.value.params.length > OWNED_CSS_RECORD_SINGLE_COUNT ||
      !origin.value.params.every(isDataParameter)
    )
      return false;
    const returned = getSingleReturnExpression(origin.value);
    if (
      !returned ||
      (!isLiteralStyleRecord(returned, origin.module) && !isReducedStyleRecord(origin))
    )
      return false;
    return hasClosedOriginBindings(origin, (value, owner) => {
      const parent = value.parent;
      return (
        isNodeOfType(parent, "CallExpression") &&
        !parent.optional &&
        parent.callee === value &&
        parent.arguments.length <= OWNED_CSS_RECORD_SINGLE_COUNT &&
        parent.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement")) &&
        hasClosedRecordUses(parent, owner)
      );
    });
  }
  const origin = resolveOrigin(receiver, module);
  return Boolean(
    origin &&
    isLiteralStyleRecord(origin.value, origin.module) &&
    hasClosedOriginBindings(origin, hasClosedRecordUses),
  );
};
