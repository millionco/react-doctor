import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface PostMountValue {
  kind: "primitive" | "number" | "input" | "ref" | "element" | "rect";
  measured: boolean;
  reflexive: boolean;
  mayBeUndefined?: boolean;
}

interface ClassPostMountProducerInput {
  call: EsTreeNode;
  setStateCall: EsTreeNode;
  scopes: ScopeAnalysis;
  callbackRefFields: ReadonlySet<string>;
}

export const isClassPostMountProducer = ({
  call,
  setStateCall,
  scopes,
  callbackRefFields,
}: ClassPostMountProducerInput): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0 ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    !isNodeOfType(stripParenExpression(call.callee.object), "ThisExpression") ||
    findEnclosingFunction(call) !== findEnclosingFunction(setStateCall)
  )
    return false;
  const classNode = findEnclosingClass(call);
  const methodName = getStaticPropertyKeyName(call.callee);
  if (
    !classNode ||
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    !classNode.id ||
    !classNode.superClass ||
    classNode.decorators?.length ||
    !methodName
  )
    return false;
  const base = resolveImportedApiReference(classNode.superClass, scopes);
  if (
    base?.source !== "react" ||
    (base.importedName !== "Component" && base.importedName !== "PureComponent")
  )
    return false;
  const members = classNode.body.body;
  const namedMembers = (name: string) =>
    members.filter((member) => getStaticPropertyKeyName(member) === name);
  if (
    members.some(
      (member) =>
        (!isNodeOfType(member, "MethodDefinition") &&
          !isNodeOfType(member, "PropertyDefinition")) ||
        member.computed ||
        member.decorators?.length,
    )
  )
    return false;
  const matches = namedMembers(methodName);
  if (matches.length !== 1) return false;
  const member = matches[0];
  if (
    (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) ||
    member.static ||
    (isNodeOfType(member, "MethodDefinition") && member.kind !== "method")
  )
    return false;
  const producer = member.value;
  if (
    !producer ||
    !isFunctionLike(producer) ||
    producer.async ||
    producer.generator ||
    producer.params.length !== 0
  )
    return false;
  const program = findProgramRoot(call);
  const classSymbol = scopes.symbolFor(classNode.id);
  if (!program || !classSymbol) return false;
  let uncertainBinding = false;
  walkAst(program, (node) => {
    if (uncertainBinding) return false;
    if (isNodeOfType(node, "ThisExpression") && findEnclosingClass(node) === classNode) {
      let receiverAncestor = node.parent;
      while (receiverAncestor && receiverAncestor !== classNode) {
        if (isFunctionLike(receiverAncestor)) {
          const declaration = receiverAncestor.parent;
          if (
            (isNodeOfType(declaration, "MethodDefinition") ||
              isNodeOfType(declaration, "PropertyDefinition")) &&
            declaration.value === receiverAncestor &&
            declaration.parent === classNode.body
          )
            break;
          if (!isNodeOfType(receiverAncestor, "ArrowFunctionExpression")) {
            uncertainBinding = true;
            return false;
          }
        }
        receiverAncestor = receiverAncestor.parent;
      }
      const parent = node.parent;
      if (
        !parent ||
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        parent.computed ||
        parent.optional
      ) {
        uncertainBinding = true;
        return false;
      }
      const name = getStaticPropertyKeyName(parent);
      if (name === "constructor" || name === "__proto__" || name === "prototype")
        uncertainBinding = true;
      if (
        name === methodName &&
        (!isNodeOfType(parent.parent, "CallExpression") ||
          parent.parent.callee !== parent ||
          parent.parent.optional)
      )
        uncertainBinding = true;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.referenceFor(node)?.resolvedSymbol === classSymbol
    ) {
      const parent = node.parent;
      if (
        isNodeOfType(parent, "ExportDefaultDeclaration") ||
        isNodeOfType(parent, "ExportSpecifier")
      )
        return;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        parent.computed ||
        parent.optional ||
        getStaticPropertyKeyName(parent) === "prototype"
      )
        uncertainBinding = true;
    }
  });
  if (uncertainBinding) return false;
  const plainField = (name: string): boolean => {
    if (["state", "props", "refs", "context", "updater", "setState", "forceUpdate"].includes(name))
      return false;
    const fields = namedMembers(name);
    return (
      fields.length === 1 &&
      isNodeOfType(fields[0], "PropertyDefinition") &&
      !fields[0].static &&
      !fields[0].computed &&
      !fields[0].declare &&
      !("abstract" in fields[0] && fields[0].abstract) &&
      fields[0].value !== null &&
      fields[0].value !== undefined
    );
  };
  const readFields = new Set<string>();
  const cacheFields = new Set<string>();
  const certifiedCacheWrites = new Set<EsTreeNode>();
  const locals = new Map<number, PostMountValue>();
  const fields = new Map<string, PostMountValue>();
  let measured = false;
  let returns = 0;
  const value = (
    kind: PostMountValue["kind"],
    fromMount = false,
    reflexive = true,
  ): PostMountValue => ({ kind, measured: fromMount, reflexive });
  const expression = (
    input: EsTreeNode,
    bindings: ReadonlyMap<number, PostMountValue>,
    cache: ReadonlyMap<string, PostMountValue>,
  ): PostMountValue | null => {
    const node = stripParenExpression(input);
    if (isNodeOfType(node, "Literal") && !("regex" in node) && !("bigint" in node)) {
      if (typeof node.value === "number") return value("number");
      if (node.value === null || typeof node.value === "string" || typeof node.value === "boolean")
        return value("primitive");
      return null;
    }
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      return symbol ? (bindings.get(symbol.id) ?? null) : null;
    }
    if (isNodeOfType(node, "MemberExpression") && !node.computed) {
      const name = getStaticPropertyKeyName(node);
      if (!name) return null;
      const receiver = stripParenExpression(node.object);
      if (isNodeOfType(receiver, "ThisExpression")) {
        if (node.optional) return null;
        if (name === "state" || name === "props") return null;
        if (cache.has(name)) return cache.get(name) ?? null;
        if (callbackRefFields.has(name) && plainField(name)) {
          readFields.add(name);
          return value("element", true);
        }
        const declarations = namedMembers(name);
        if (
          plainField(name) &&
          declarations.length === 1 &&
          isNodeOfType(declarations[0], "PropertyDefinition")
        ) {
          const initial = declarations[0].value;
          if (
            initial &&
            isNodeOfType(initial, "CallExpression") &&
            initial.arguments.length === 0
          ) {
            const api = resolveImportedApiReference(initial.callee, scopes);
            if (api?.source === "react" && api.importedName === "createRef") {
              readFields.add(name);
              return value("ref");
            }
          }
        }
        return null;
      }
      if (
        !node.optional &&
        isNodeOfType(receiver, "MemberExpression") &&
        !receiver.computed &&
        !receiver.optional &&
        isNodeOfType(stripParenExpression(receiver.object), "ThisExpression") &&
        getStaticPropertyKeyName(receiver) === "props"
      )
        return value("input");
      const object = expression(receiver, bindings, cache);
      if (!node.optional && object?.kind === "ref" && name === "current")
        return value("element", true);
      if (
        (object?.kind === "rect" && (name === "width" || name === "height")) ||
        (object?.kind === "element" &&
          [
            "naturalWidth",
            "naturalHeight",
            "videoWidth",
            "videoHeight",
            "offsetWidth",
            "offsetHeight",
          ].includes(name))
      )
        return {
          ...value("number", true, false),
          mayBeUndefined: node.optional === true || object.mayBeUndefined === true,
        };
      return null;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      !node.optional &&
      node.arguments.length === 0 &&
      isNodeOfType(node.callee, "MemberExpression") &&
      !node.callee.computed &&
      !node.callee.optional
    ) {
      const object = expression(node.callee.object, bindings, cache);
      if (
        object?.kind === "element" &&
        getStaticPropertyKeyName(node.callee) === "getBoundingClientRect"
      ) {
        measured = true;
        return value("rect", true);
      }
      return null;
    }
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
      const operand = expression(node.argument, bindings, cache);
      return operand ? value("primitive", operand.measured) : null;
    }
    if (isNodeOfType(node, "BinaryExpression")) {
      const left = expression(node.left, bindings, cache),
        right = expression(node.right, bindings, cache);
      if (!left || !right) return null;
      const fromMount = left.measured || right.measured;
      if (node.operator === "===" || node.operator === "!==") return value("primitive", fromMount);
      if (
        left.kind !== "number" ||
        right.kind !== "number" ||
        left.mayBeUndefined ||
        right.mayBeUndefined
      )
        return null;
      if (["<", ">", "<=", ">="].includes(node.operator)) return value("primitive", fromMount);
      if (["+", "-", "*", "/", "%"].includes(node.operator))
        return value("number", fromMount, false);
      return null;
    }
    if (
      isNodeOfType(node, "LogicalExpression") &&
      (node.operator === "&&" || node.operator === "||")
    ) {
      const left = expression(node.left, bindings, cache),
        right = expression(node.right, bindings, cache);
      if (!left || !right || left.kind !== right.kind) return null;
      return {
        ...value(left.kind, left.measured || right.measured, left.reflexive && right.reflexive),
        mayBeUndefined:
          node.operator === "||"
            ? right.mayBeUndefined
            : left.mayBeUndefined || right.mayBeUndefined,
      };
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      const testValue = expression(node.test, bindings, cache);
      const consequentValue = expression(node.consequent, bindings, cache);
      const alternateValue = expression(node.alternate, bindings, cache);
      return testValue &&
        consequentValue &&
        alternateValue &&
        consequentValue.kind === alternateValue.kind
        ? {
            ...value(
              consequentValue.kind,
              testValue.measured || consequentValue.measured || alternateValue.measured,
              consequentValue.reflexive && alternateValue.reflexive,
            ),
            mayBeUndefined: consequentValue.mayBeUndefined || alternateValue.mayBeUndefined,
          }
        : null;
    }
    return null;
  };
  const statement = (
    node: EsTreeNode,
    bindings: Map<number, PostMountValue>,
    cache: Map<string, PostMountValue>,
  ): boolean => {
    if (isNodeOfType(node, "BlockStatement"))
      return node.body.every((child) => statement(child, bindings, cache));
    if (isNodeOfType(node, "VariableDeclaration") && node.kind === "const")
      return node.declarations.every((declaration) => {
        if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
        const symbol = scopes.symbolFor(declaration.id),
          result = expression(declaration.init, bindings, cache);
        if (
          !symbol ||
          symbol.kind !== "const" ||
          symbol.bindingIdentifier !== declaration.id ||
          symbol.references.some((reference) => reference.flag !== "read") ||
          !result
        )
          return false;
        bindings.set(symbol.id, result);
        return true;
      });
    if (isNodeOfType(node, "ReturnStatement")) {
      const result = node.argument
        ? expression(node.argument, bindings, cache)
        : value("primitive");
      if (
        !result ||
        result.mayBeUndefined ||
        !result.reflexive ||
        !["primitive", "number", "input"].includes(result.kind)
      )
        return false;
      returns += 1;
      return true;
    }
    if (isNodeOfType(node, "IfStatement"))
      return (
        Boolean(expression(node.test, bindings, cache)) &&
        statement(node.consequent, new Map(bindings), new Map(cache)) &&
        (!node.alternate || statement(node.alternate, new Map(bindings), new Map(cache)))
      );
    if (!isNodeOfType(node, "ExpressionStatement")) return false;
    const operation = stripParenExpression(node.expression);
    if (
      isNodeOfType(operation, "AssignmentExpression") &&
      operation.operator === "=" &&
      isNodeOfType(operation.left, "MemberExpression") &&
      !operation.left.computed &&
      !operation.left.optional &&
      isNodeOfType(stripParenExpression(operation.left.object), "ThisExpression")
    ) {
      const field = getStaticPropertyKeyName(operation.left),
        result = expression(operation.right, bindings, cache);
      if (!field || field === methodName || !plainField(field) || result?.kind !== "rect")
        return false;
      cacheFields.add(field);
      certifiedCacheWrites.add(operation);
      cache.set(field, result);
      return true;
    }
    return false;
  };
  if (!isNodeOfType(producer.body, "BlockStatement") || !statement(producer.body, locals, fields))
    return false;
  if (!measured || returns === 0) return false;
  const protectedFields = new Set([...readFields, ...cacheFields]);
  const aliases = new Map<number, "ref" | "element" | "rect" | "wrapper">();
  const mutatorAliases = new Set<number>();
  const mutatorNames = new Set([
    "assign",
    "defineProperty",
    "defineProperties",
    "set",
    "deleteProperty",
    "setPrototypeOf",
    "call",
    "apply",
    "bind",
  ]);
  const directField = (input: EsTreeNode): string | null => {
    let node = stripParenExpression(input);
    let field: string | null = null;
    while (isNodeOfType(node, "MemberExpression")) {
      field = getStaticPropertyKeyName(node, { allowComputedString: true });
      node = stripParenExpression(node.object);
    }
    return isNodeOfType(node, "ThisExpression") && findEnclosingClass(node) === classNode
      ? field
      : null;
  };
  const aliasKind = (input: EsTreeNode): "ref" | "element" | "rect" | "wrapper" | null => {
    const node = stripParenExpression(input);
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      return symbol ? (aliases.get(symbol.id) ?? null) : null;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const receiver = stripParenExpression(node.object);
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (isNodeOfType(receiver, "ThisExpression") && findEnclosingClass(receiver) === classNode) {
        if (name && cacheFields.has(name)) return "rect";
        if (name && readFields.has(name)) return callbackRefFields.has(name) ? "element" : "ref";
        return null;
      }
      const kind = aliasKind(receiver);
      if (kind === "ref" && name === "current") return "element";
      if (
        kind === "rect" &&
        name &&
        ["width", "height", "left", "right", "top", "bottom", "x", "y"].includes(name)
      )
        return null;
      if (
        kind === "element" &&
        name &&
        [
          "naturalWidth",
          "naturalHeight",
          "videoWidth",
          "videoHeight",
          "offsetWidth",
          "offsetHeight",
          "ownerDocument",
        ].includes(name)
      )
        return null;
      return kind ? "wrapper" : null;
    }
    if (isNodeOfType(node, "CallExpression")) {
      if (
        isNodeOfType(node.callee, "MemberExpression") &&
        getStaticPropertyKeyName(node.callee) === "getBoundingClientRect" &&
        aliasKind(node.callee.object) === "element"
      )
        return "rect";
      return node.arguments.some(
        (argument) => !isNodeOfType(argument, "SpreadElement") && aliasKind(argument) !== null,
      )
        ? "wrapper"
        : null;
    }
    if (isNodeOfType(node, "SequenceExpression"))
      return node.expressions.map(aliasKind).find((kind) => kind !== null) ?? null;
    if (isNodeOfType(node, "AssignmentExpression"))
      return aliasKind(node.left) ?? aliasKind(node.right);
    if (isNodeOfType(node, "LogicalExpression"))
      return aliasKind(node.left) ?? aliasKind(node.right);
    if (isNodeOfType(node, "ConditionalExpression"))
      return aliasKind(node.consequent) ?? aliasKind(node.alternate);
    if (isNodeOfType(node, "ObjectExpression"))
      return node.properties.some((property) =>
        isNodeOfType(property, "Property")
          ? aliasKind(property.value) !== null
          : isNodeOfType(property, "SpreadElement") && aliasKind(property.argument) !== null,
      )
        ? "wrapper"
        : null;
    if (isNodeOfType(node, "ArrayExpression"))
      return node.elements.some(
        (element) =>
          element &&
          (isNodeOfType(element, "SpreadElement")
            ? aliasKind(element.argument) !== null
            : aliasKind(element) !== null),
      )
        ? "wrapper"
        : null;
    return null;
  };
  const isMutatorAlias = (input: EsTreeNode): boolean => {
    const node = stripParenExpression(input);
    if (isFunctionLike(node)) return true;
    if (isNodeOfType(node, "LogicalExpression") || isNodeOfType(node, "AssignmentExpression"))
      return isMutatorAlias(node.left) || isMutatorAlias(node.right);
    if (isNodeOfType(node, "ConditionalExpression"))
      return isMutatorAlias(node.consequent) || isMutatorAlias(node.alternate);
    if (isNodeOfType(node, "SequenceExpression")) return node.expressions.some(isMutatorAlias);

    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        name &&
        isNodeOfType(stripParenExpression(node.object), "ThisExpression") &&
        findEnclosingClass(node) === classNode &&
        namedMembers(name).some(
          (candidate) =>
            (isNodeOfType(candidate, "MethodDefinition") ||
              isNodeOfType(candidate, "PropertyDefinition")) &&
            candidate.value &&
            isFunctionLike(candidate.value),
        )
      )
        return true;
      return mutatorNames.has(name ?? "") || isMutatorAlias(node.object);
    }
    if (isNodeOfType(node, "CallExpression")) return isMutatorAlias(node.callee);
    if (isNodeOfType(node, "ObjectExpression"))
      return node.properties.some((property) =>
        isNodeOfType(property, "Property")
          ? isMutatorAlias(property.value)
          : isNodeOfType(property, "SpreadElement") && isMutatorAlias(property.argument),
      );
    if (isNodeOfType(node, "ArrayExpression"))
      return node.elements.some(
        (element) =>
          element &&
          (isNodeOfType(element, "SpreadElement")
            ? isMutatorAlias(element.argument)
            : isMutatorAlias(element)),
      );
    const symbol = isNodeOfType(node, "Identifier") ? scopes.symbolFor(node) : null;
    return Boolean(
      symbol &&
      (mutatorAliases.has(symbol.id) ||
        (isNodeOfType(symbol.bindingIdentifier.parent, "FunctionDeclaration") &&
          symbol.bindingIdentifier.parent.id === symbol.bindingIdentifier)),
    );
  };
  const isExactJsxRefWrite = (operation: EsTreeNode): boolean => {
    if (
      !isNodeOfType(operation, "AssignmentExpression") ||
      operation.operator !== "=" ||
      !isNodeOfType(operation.left, "MemberExpression") ||
      operation.left.computed ||
      !isNodeOfType(stripParenExpression(operation.left.object), "ThisExpression") ||
      !isNodeOfType(operation.right, "Identifier")
    )
      return false;
    const field = getStaticPropertyKeyName(operation.left);
    if (!field || !callbackRefFields.has(field) || !plainField(field)) return false;
    const callback = findEnclosingFunction(operation);
    if (
      !callback ||
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      callback.async ||
      callback.params.length !== 1 ||
      !isNodeOfType(callback.params[0], "Identifier") ||
      stripParenExpression(callback.body) !== operation
    )
      return false;
    const parameter = scopes.symbolFor(callback.params[0]);
    if (!parameter || scopes.symbolFor(operation.right) !== parameter) return false;
    const container = callback.parent;
    return (
      isNodeOfType(container, "JSXExpressionContainer") &&
      isNodeOfType(container.parent, "JSXAttribute") &&
      isNodeOfType(container.parent.name, "JSXIdentifier") &&
      container.parent.name.name === "ref"
    );
  };
  let changed = true;
  let unsupportedAlias = false;
  let supportedMutatorOnlyDestructureSeen = false;
  let knownProtectedReturn = false;
  while (changed) {
    changed = false;
    walkAst(program, (node) => {
      let returnedValue: EsTreeNode | null | undefined = null;
      if (isNodeOfType(node, "ReturnStatement") || isNodeOfType(node, "YieldExpression")) {
        returnedValue = node.argument;
      } else if (
        isNodeOfType(node, "ArrowFunctionExpression") &&
        !isNodeOfType(node.body, "BlockStatement")
      ) {
        returnedValue = node.body;
      }
      if (
        returnedValue &&
        aliasKind(returnedValue) !== null &&
        !isExactJsxRefWrite(returnedValue)
      ) {
        knownProtectedReturn = true;
        return;
      }
      let target: EsTreeNode | null = null;
      if (isNodeOfType(node, "VariableDeclarator")) {
        target = node.id;
      } else if (isNodeOfType(node, "AssignmentExpression") && node.operator === "=") {
        target = node.left;
      }
      let source: EsTreeNode | null | undefined = null;
      if (isNodeOfType(node, "VariableDeclarator")) {
        source = node.init;
      } else if (isNodeOfType(node, "AssignmentExpression") && node.operator === "=") {
        source = node.right;
      }
      if (!target || !source) return;
      if (
        isNodeOfType(target, "ObjectPattern") &&
        target.properties.some(
          (property) =>
            !isNodeOfType(property, "Property") ||
            getStaticPropertyKeyName(property, { allowComputedString: true }) === null ||
            mutatorNames.has(
              getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
            ),
        )
      ) {
        unsupportedAlias = true;
        return;
      }
      const protectedKind = aliasKind(source);
      const isProtected = protectedKind !== null;
      const isMutator = isMutatorAlias(source);
      if (!isProtected && !isMutator) return;
      if (!isProtected && isMutator && isNodeOfType(target, "ObjectPattern")) {
        const extractedMutatorSymbolIds: number[] = [];
        let supportedBindings = true;
        for (const property of target.properties) {
          if (
            !isNodeOfType(property, "Property") ||
            property.computed ||
            !isNodeOfType(property.value, "Identifier")
          ) {
            supportedBindings = false;
            break;
          }
          const symbol = scopes.symbolFor(property.value);
          if (!symbol || symbol.bindingIdentifier !== property.value) {
            supportedBindings = false;
            break;
          }
          extractedMutatorSymbolIds.push(symbol.id);
        }
        if (supportedBindings) {
          supportedMutatorOnlyDestructureSeen = true;
          for (const symbolId of extractedMutatorSymbolIds) {
            if (!mutatorAliases.has(symbolId)) {
              mutatorAliases.add(symbolId);
              changed = true;
            }
          }
          return;
        }
      }
      if (!isNodeOfType(target, "Identifier")) {
        if (isNodeOfType(target, "ObjectPattern") || isNodeOfType(target, "ArrayPattern"))
          unsupportedAlias = true;
        if (
          isProtected &&
          isNodeOfType(target, "MemberExpression") &&
          !certifiedCacheWrites.has(node) &&
          !(cacheFields.has(getStaticPropertyKeyName(target) ?? "") && protectedKind === "rect")
        )
          unsupportedAlias = true;
        return;
      }
      const symbol = scopes.symbolFor(target);
      if (!symbol) {
        unsupportedAlias = true;
        return;
      }
      if (protectedKind) {
        const previousKind = aliases.get(symbol.id);
        if (!previousKind) {
          aliases.set(symbol.id, protectedKind);
          changed = true;
        } else if (previousKind !== protectedKind && previousKind !== "wrapper") {
          aliases.set(symbol.id, "wrapper");
          changed = true;
        }
      }
      if (isMutator && !mutatorAliases.has(symbol.id)) {
        mutatorAliases.add(symbol.id);
        changed = true;
      }
    });
  }
  if (unsupportedAlias || (supportedMutatorOnlyDestructureSeen && knownProtectedReturn))
    return false;
  const isProtectedTarget = (input: EsTreeNode, allowIdentifier = false): boolean => {
    let node = stripParenExpression(input);
    if (!allowIdentifier && !isNodeOfType(node, "MemberExpression")) return false;
    const field = directField(node);
    if (field && protectedFields.has(field)) return true;
    while (isNodeOfType(node, "MemberExpression")) node = stripParenExpression(node.object);
    const symbol = isNodeOfType(node, "Identifier") ? scopes.symbolFor(node) : null;
    return Boolean(symbol && aliases.has(symbol.id));
  };
  const isProtectedArgument = (argument: EsTreeNode): boolean =>
    isNodeOfType(argument, "SpreadElement")
      ? aliasKind(argument.argument) !== null
      : isProtectedTarget(argument, true) || aliasKind(argument) !== null;
  let knownMutation = false;
  walkAst(program, (node) => {
    if (knownMutation) return false;
    let target: EsTreeNode | null = null;
    if (isNodeOfType(node, "AssignmentExpression")) {
      target = node.left;
    } else if (isNodeOfType(node, "UpdateExpression")) {
      target = node.argument;
    } else if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
      target = node.argument;
    }
    if (target && isProtectedTarget(target)) {
      if (certifiedCacheWrites.has(node) || isExactJsxRefWrite(node)) return;
      if (
        isNodeOfType(node, "AssignmentExpression") &&
        node.operator === "=" &&
        isNodeOfType(node.left, "MemberExpression") &&
        !node.left.computed &&
        isNodeOfType(stripParenExpression(node.left.object), "ThisExpression") &&
        cacheFields.has(getStaticPropertyKeyName(node.left) ?? "") &&
        expression(node.right, new Map(), new Map())?.kind === "rect"
      )
        return;
      knownMutation = true;
    }
    if (isNodeOfType(node, "CallExpression") && isMutatorAlias(node.callee)) {
      if (node.arguments.some(isProtectedArgument)) knownMutation = true;
    }
    if (isNodeOfType(node, "NewExpression") && node.arguments.some(isProtectedArgument))
      knownMutation = true;
    if (
      isNodeOfType(node, "TaggedTemplateExpression") &&
      node.quasi.expressions.some(isProtectedArgument)
    )
      knownMutation = true;
  });
  return !knownMutation;
};
