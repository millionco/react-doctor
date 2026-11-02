import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type {
  RequestActionProgram,
  RequestActionProof,
  RequestActionValue,
} from "./get-imported-request-action-evidence.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface RequestArgument {
  readonly node: EsTreeNode;
  readonly facts: RequestActionProgram;
  readonly bindings: ReadonlyMap<SymbolDescriptor, RequestArgument>;
}

export const isImportedMutatingRequest = (node: EsTreeNode, proof: RequestActionProof): boolean => {
  const emptyBindings = new Map<SymbolDescriptor, RequestArgument>();
  const unwrapArgument = (argument: RequestArgument): RequestArgument => {
    const expression = stripParenExpression(argument.node);
    if (!isNodeOfType(expression, "Identifier")) return { ...argument, node: expression };
    const symbol = argument.facts.scopes.symbolFor(expression);
    const mapped = symbol ? argument.bindings.get(symbol) : null;
    return mapped ? unwrapArgument(mapped) : { ...argument, node: expression };
  };
  const literalString = (argument: RequestArgument): string | null => {
    const value = unwrapArgument(argument);
    if (isNodeOfType(value.node, "Literal") && typeof value.node.value === "string")
      return value.node.value;
    if (isNodeOfType(value.node, "Identifier")) {
      const symbol = value.facts.scopes.symbolFor(value.node);
      if (
        symbol?.kind === "const" &&
        proof.closed(symbol, value.facts) &&
        isNodeOfType(symbol.initializer, "Literal") &&
        typeof symbol.initializer.value === "string"
      )
        return symbol.initializer.value;
    }
    return null;
  };
  const canonicalAxios = (receiver: EsTreeNode, facts: RequestActionProgram): boolean => {
    if (!proof.api(receiver, "axios", "default", facts)) return false;
    const expression = stripParenExpression(receiver);
    if (!isNodeOfType(expression, "Identifier")) return false;
    const symbol = facts.scopes.symbolFor(expression);
    return Boolean(
      symbol &&
      getRuntimeSymbolReferences(symbol).every((reference) => {
        let selected: EsTreeNode = reference.identifier;
        while (
          isNodeOfType(selected.parent, "MemberExpression") &&
          selected.parent.object === selected
        )
          selected = selected.parent;
        const parent = selected.parent;
        if (isNodeOfType(parent, "AssignmentExpression") && parent.left === selected) return false;
        if (
          isNodeOfType(parent, "UpdateExpression") ||
          (isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete")
        )
          return false;
        if (selected !== reference.identifier) {
          if (!isNodeOfType(selected, "MemberExpression") || selected.optional) return false;
          const propertyName = getStaticPropertyName(selected);
          if (
            isNodeOfType(parent, "CallExpression") &&
            parent.callee === selected &&
            !parent.optional
          ) {
            if (
              selected.object === reference.identifier &&
              reference.identifier === receiver &&
              selected.computed
            )
              return true;
            if (
              selected.object === reference.identifier &&
              propertyName &&
              ["get", "post", "put", "patch", "delete"].includes(propertyName)
            )
              return (
                parent.arguments.length === 2 &&
                parent.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
              );
            return (
              selected.object === reference.identifier &&
              propertyName === "create" &&
              parent.arguments.length === 1
            );
          }
          if (
            propertyName !== "transformResponse" ||
            !isNodeOfType(selected.object, "MemberExpression") ||
            getStaticPropertyName(selected.object) !== "defaults" ||
            selected.object.object !== reference.identifier
          )
            return false;
          if (isNodeOfType(parent, "BinaryExpression") && ["==", "==="].includes(parent.operator))
            return isNodeOfType(parent.left === selected ? parent.right : parent.left, "Literal");
          if (isNodeOfType(parent, "ConditionalExpression") && parent.consequent === selected)
            return true;
          if (isNodeOfType(parent, "ArrayExpression"))
            return parent.elements.length === 1 && parent.elements[0] === selected;
          return (
            isNodeOfType(parent, "CallExpression") &&
            parent.arguments.length === 1 &&
            parent.arguments[0] === selected &&
            isNodeOfType(parent.callee, "MemberExpression") &&
            getStaticPropertyName(parent.callee) === "isArray" &&
            isNodeOfType(parent.callee.object, "Identifier") &&
            parent.callee.object.name === "Array" &&
            facts.scopes.isGlobalReference(parent.callee.object)
          );
        }
        return (
          isNodeOfType(parent, "CallExpression") &&
          isNodeOfType(parent.callee, "MemberExpression") &&
          getStaticPropertyName(parent.callee) === "assign" &&
          isNodeOfType(parent.callee.object, "Identifier") &&
          parent.callee.object.name === "Object" &&
          facts.scopes.isGlobalReference(parent.callee.object) &&
          parent.arguments[1] === selected
        );
      }),
    );
  };
  const onlyReturns = (functionNode: EsTreeNode): EsTreeNode | null => {
    if (!isFunctionLike(functionNode) || functionNode.generator || !functionNode.body) return null;
    if (!isNodeOfType(functionNode.body, "BlockStatement")) return functionNode.body;
    const returns = collectFunctionReturnStatements(functionNode);
    return returns.length === 1 ? (returns[0]?.argument ?? null) : null;
  };
  const configuredFactory = (factory: RequestActionValue): boolean => {
    const functionNode = factory.node;
    if (
      !isFunctionLike(functionNode) ||
      functionNode.async ||
      functionNode.generator ||
      !isNodeOfType(functionNode.body, "BlockStatement") ||
      !proof.closedFunction(functionNode, factory.facts)
    )
      return false;
    if (
      functionNode.params.length > 1 ||
      functionNode.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
    )
      return false;
    const returned = onlyReturns(functionNode);
    if (!returned || !isNodeOfType(returned, "Identifier")) return false;
    const instance = factory.facts.scopes.symbolFor(returned);
    if (
      !instance ||
      !proof.closed(instance, factory.facts) ||
      !isNodeOfType(instance.initializer, "CallExpression")
    )
      return false;
    const creation = instance.initializer;
    if (
      creation.optional ||
      creation.arguments.length !== 1 ||
      !isNodeOfType(creation.callee, "MemberExpression") ||
      creation.callee.optional ||
      getStaticPropertyName(creation.callee) !== "create" ||
      !canonicalAxios(creation.callee.object, factory.facts)
    )
      return false;
    const body = functionNode.body.body;
    const transformsDeclaration = body[0];
    const instanceDeclaration = body[1];
    const interceptorStatement = body[2];
    const returnStatement = body[3];
    if (
      body.length !== 4 ||
      !isNodeOfType(transformsDeclaration, "VariableDeclaration") ||
      transformsDeclaration.kind !== "const" ||
      transformsDeclaration.declarations.length !== 1 ||
      !isNodeOfType(instanceDeclaration, "VariableDeclaration") ||
      instanceDeclaration.declarations.length !== 1 ||
      instanceDeclaration.declarations[0] !== instance.declarationNode ||
      !isNodeOfType(interceptorStatement, "ExpressionStatement") ||
      !isNodeOfType(interceptorStatement.expression, "CallExpression") ||
      !isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== returned
    )
      return false;
    const interceptorCall = interceptorStatement.expression;
    const transformsBinding = transformsDeclaration.declarations[0];
    if (
      !getRuntimeSymbolReferences(instance).every(
        (reference) =>
          reference.identifier === returned ||
          (isNodeOfType(reference.identifier.parent, "MemberExpression") &&
            reference.identifier.parent.object === reference.identifier &&
            isNodeOfType(reference.identifier.parent.parent, "MemberExpression") &&
            isNodeOfType(reference.identifier.parent.parent.parent, "MemberExpression") &&
            reference.identifier.parent.parent.parent.parent === interceptorCall),
      )
    )
      return false;
    const options = creation.arguments[0];
    if (!isNodeOfType(options, "ObjectExpression")) return false;
    for (const option of options.properties) {
      if (isNodeOfType(option, "SpreadElement")) {
        const parameter = functionNode.params[0];
        if (
          functionNode.params.length !== 1 ||
          !isNodeOfType(parameter, "Identifier") ||
          !isNodeOfType(option.argument, "Identifier") ||
          factory.facts.scopes.symbolFor(option.argument) !==
            factory.facts.scopes.symbolFor(parameter)
        )
          return false;
        continue;
      }
      if (
        !isNodeOfType(option, "Property") ||
        option.computed ||
        option.method ||
        option.kind !== "init" ||
        !isNodeOfType(option.key, "Identifier") ||
        !["headers", "transformResponse"].includes(option.key.name)
      )
        return false;
      if (
        option.key.name === "headers" &&
        (!isNodeOfType(option.value, "ObjectExpression") ||
          option.value.properties.some(
            (member) =>
              !isNodeOfType(member, "Property") ||
              member.computed ||
              member.method ||
              member.kind !== "init" ||
              !isNodeOfType(member.value, "Literal") ||
              typeof member.value.value !== "string",
          ))
      )
        return false;
    }
    let invalid = false;
    walkAst(functionNode.body, (current) => {
      if (
        isNodeOfType(current, "AwaitExpression") ||
        isNodeOfType(current, "YieldExpression") ||
        isNodeOfType(current, "ThrowStatement")
      )
        invalid = true;
      if (
        isNodeOfType(current, "AssignmentExpression") &&
        (!isNodeOfType(current.left, "MemberExpression") ||
          getStaticPropertyName(current.left) !== "paramsSerializer")
      )
        invalid = true;
      if (!isNodeOfType(current, "CallExpression")) return true;
      const callee = stripParenExpression(current.callee);
      if (current === creation) return true;
      if (proof.api(callee, "qs", "default", factory.facts)) {
        invalid = true;
        return false;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        proof.api(callee.object, "qs", "default", factory.facts) &&
        getStaticPropertyName(callee) === "stringify"
      )
        return true;
      if (proof.api(callee, "date-fns/formatISO", "formatISO", factory.facts)) return true;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "isArray" &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "Array" &&
        factory.facts.scopes.isGlobalReference(callee.object)
      )
        return true;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "concat" &&
        isNodeOfType(callee.object, "Identifier") &&
        factory.facts.scopes.symbolFor(callee.object)?.declarationNode === transformsBinding
      )
        return true;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "use" &&
        isNodeOfType(callee.object, "MemberExpression") &&
        getStaticPropertyName(callee.object) === "request" &&
        isNodeOfType(callee.object.object, "MemberExpression") &&
        getStaticPropertyName(callee.object.object) === "interceptors" &&
        isNodeOfType(callee.object.object.object, "Identifier") &&
        factory.facts.scopes.symbolFor(callee.object.object.object) === instance
      ) {
        const interceptor = current.arguments[0];
        if (
          current.arguments.length !== 1 ||
          !isFunctionLike(interceptor) ||
          interceptor.async ||
          interceptor.generator ||
          interceptor.params.length !== 1 ||
          !isNodeOfType(interceptor.params[0], "Identifier") ||
          !isNodeOfType(interceptor.body, "BlockStatement") ||
          interceptor.body.body.length !== 2
        ) {
          invalid = true;
          return false;
        }
        const assignment = interceptor.body.body[0];
        const returnedConfig = interceptor.body.body[1];
        if (
          !isNodeOfType(assignment, "ExpressionStatement") ||
          !isNodeOfType(assignment.expression, "AssignmentExpression") ||
          assignment.expression.operator !== "=" ||
          !isNodeOfType(assignment.expression.left, "MemberExpression") ||
          getStaticPropertyName(assignment.expression.left) !== "paramsSerializer" ||
          !isNodeOfType(assignment.expression.left.object, "Identifier") ||
          factory.facts.scopes.symbolFor(assignment.expression.left.object) !==
            factory.facts.scopes.symbolFor(interceptor.params[0]) ||
          !isNodeOfType(returnedConfig, "ReturnStatement") ||
          !isNodeOfType(returnedConfig.argument, "Identifier") ||
          factory.facts.scopes.symbolFor(returnedConfig.argument) !==
            factory.facts.scopes.symbolFor(interceptor.params[0])
        )
          invalid = true;
        if (
          isNodeOfType(assignment, "ExpressionStatement") &&
          isNodeOfType(assignment.expression, "AssignmentExpression")
        ) {
          const serializer = assignment.expression.right;
          if (
            !isFunctionLike(serializer) ||
            serializer.async ||
            serializer.generator ||
            serializer.params.length !== 1 ||
            !isNodeOfType(serializer.params[0], "Identifier") ||
            !isNodeOfType(serializer.body, "CallExpression") ||
            serializer.body.optional ||
            serializer.body.arguments.length !== 2 ||
            !isNodeOfType(serializer.body.callee, "MemberExpression") ||
            getStaticPropertyName(serializer.body.callee) !== "stringify" ||
            !proof.api(serializer.body.callee.object, "qs", "default", factory.facts) ||
            !isNodeOfType(serializer.body.arguments[0], "Identifier") ||
            factory.facts.scopes.symbolFor(serializer.body.arguments[0]) !==
              factory.facts.scopes.symbolFor(serializer.params[0])
          ) {
            invalid = true;
            return false;
          }
          const serializationOptions = serializer.body.arguments[1];
          if (
            !isNodeOfType(serializationOptions, "ObjectExpression") ||
            serializationOptions.properties.length !== 1
          ) {
            invalid = true;
            return false;
          }
          const dateSerializer = proof.property(serializationOptions, "serializeDate");
          const dateSerialization = dateSerializer
            ? getSingleReturnExpression(dateSerializer)
            : null;
          if (
            !isFunctionLike(dateSerializer) ||
            dateSerializer.async ||
            dateSerializer.generator ||
            dateSerializer.params.length !== 1 ||
            !isNodeOfType(dateSerializer.params[0], "Identifier") ||
            !isNodeOfType(dateSerialization, "CallExpression") ||
            dateSerialization.optional ||
            dateSerialization.arguments.length !== 2 ||
            !proof.api(
              dateSerialization.callee,
              "date-fns/formatISO",
              "formatISO",
              factory.facts,
            ) ||
            !isNodeOfType(dateSerialization.arguments[0], "Identifier") ||
            factory.facts.scopes.symbolFor(dateSerialization.arguments[0]) !==
              factory.facts.scopes.symbolFor(dateSerializer.params[0])
          ) {
            invalid = true;
            return false;
          }
        }
        return true;
      }
      if (
        isNodeOfType(callee, "Identifier") &&
        resolveImportedApiReference(callee, factory.facts.scopes) &&
        proof.closed(factory.facts.scopes.symbolFor(callee), factory.facts) &&
        current.arguments.length === 1 &&
        findResponseTransform(current)
      )
        return true;
      invalid = true;
      return true;
    });
    return !invalid;
  };
  const findResponseTransform = (node: EsTreeNode): boolean => {
    let ancestor = node.parent;
    while (ancestor && !isNodeOfType(ancestor, "Property")) ancestor = ancestor.parent;
    return Boolean(
      ancestor &&
      isNodeOfType(ancestor, "Property") &&
      isNodeOfType(ancestor.key, "Identifier") &&
      ancestor.key.name === "transformResponse",
    );
  };
  const axiosReceiver = (receiver: EsTreeNode, facts: RequestActionProgram): boolean => {
    if (canonicalAxios(receiver, facts)) return true;
    const expression = stripParenExpression(receiver);
    if (!isNodeOfType(expression, "Identifier")) return false;
    const receiverBinding = facts.scopes.symbolFor(expression);
    if (
      !receiverBinding ||
      !proof.closed(receiverBinding, facts) ||
      !getRuntimeSymbolReferences(receiverBinding).every((reference) => {
        const member = reference.identifier.parent;
        const call = member?.parent;
        return (
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference.identifier &&
          !member.optional &&
          isNodeOfType(call, "CallExpression") &&
          call.callee === member &&
          !call.optional &&
          call.arguments.length === 2 &&
          call.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement")) &&
          (reference.identifier === receiver ||
            ["get", "post", "put", "patch", "delete"].includes(getStaticPropertyName(member) ?? ""))
        );
      })
    )
      return false;
    const facade = proof.resolve(receiver, facts);
    if (facade) {
      const bindings = facade.facts.scopes.rootScope.symbols.filter(
        (binding) =>
          binding.initializer && stripParenExpression(binding.initializer) === facade.node,
      );
      if (
        bindings.length !== 1 ||
        !bindings[0]?.references.every((reference) =>
          isNodeOfType(reference.identifier.parent, "ExportDefaultDeclaration"),
        )
      )
        return false;
    }
    if (
      !facade ||
      !isNodeOfType(facade.node, "CallExpression") ||
      facade.node.optional ||
      !isNodeOfType(facade.node.callee, "MemberExpression") ||
      getStaticPropertyName(facade.node.callee) !== "assign" ||
      !isNodeOfType(facade.node.callee.object, "Identifier") ||
      facade.node.callee.object.name !== "Object" ||
      !facade.facts.scopes.isGlobalReference(facade.node.callee.object) ||
      facade.node.arguments.length !== 4
    )
      return false;
    const [target, canonical, configured, overrides] = facade.node.arguments;
    if (
      !isNodeOfType(target, "ObjectExpression") ||
      target.properties.length !== 0 ||
      !canonical ||
      !canonicalAxios(canonical, facade.facts) ||
      !isNodeOfType(configured, "CallExpression") ||
      configured.optional ||
      configured.arguments.length !== 0 ||
      !isNodeOfType(overrides, "ObjectExpression") ||
      overrides.properties.length !== 1
    )
      return false;
    const factory = proof.resolve(configured.callee, facade.facts);
    const override = proof.property(overrides, "create");
    const overrideFactory = override ? proof.resolve(override, facade.facts) : null;
    return Boolean(
      factory &&
      overrideFactory &&
      factory.node === overrideFactory.node &&
      configuredFactory(factory),
    );
  };
  const visited = new Set<EsTreeNode>();
  const requestCall = (input: RequestArgument): boolean => {
    const selected = unwrapArgument(input);
    const call = selected.node;
    if (!isNodeOfType(call, "CallExpression") || call.optional || visited.has(call)) return false;
    visited.add(call);
    if (
      isNodeOfType(call.callee, "MemberExpression") &&
      !call.callee.optional &&
      axiosReceiver(call.callee.object, selected.facts)
    ) {
      const method = call.callee.computed
        ? literalString({ ...selected, node: call.callee.property })
        : getStaticPropertyName(call.callee);
      if (!method || !["post", "put", "patch", "delete"].includes(method)) return false;
      const endpointArgument = call.arguments[0];
      if (
        !endpointArgument ||
        call.arguments.length !== 2 ||
        call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        return false;
      let endpoint = literalString({ ...selected, node: endpointArgument });
      if (
        !endpoint &&
        isNodeOfType(endpointArgument, "CallExpression") &&
        !endpointArgument.optional &&
        proof.api(endpointArgument.callee, "url-join", "default", selected.facts) &&
        endpointArgument.arguments.length === 2
      ) {
        const prefix = endpointArgument.arguments[0];
        const suffix = endpointArgument.arguments[1];
        const prefixText = prefix ? literalString({ ...selected, node: prefix }) : null;
        const suffixText = suffix ? literalString({ ...selected, node: suffix }) : null;
        if (prefixText && suffixText) endpoint = `${prefixText}/${suffixText}`;
      }
      if (!endpoint) return false;
      const segment = endpoint.split(/[?#]/u)[0]?.split("/").filter(Boolean).at(-1) ?? "";
      return !/^(?:preview|render|search|query|validate|verify|check|stop|cancel|abort)$/iu.test(
        segment,
      );
    }
    const resolved = proof.resolve(call.callee, selected.facts);
    if (
      !resolved ||
      !isFunctionLike(resolved.node) ||
      resolved.node.generator ||
      !proof.closedFunction(resolved.node, resolved.facts) ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return false;
    const bindings = new Map<SymbolDescriptor, RequestArgument>();
    for (let index = 0; index < resolved.node.params.length; index += 1) {
      const parameter = resolved.node.params[index];
      if (isNodeOfType(parameter, "AssignmentPattern")) {
        const defaultValue = stripParenExpression(parameter.right);
        const primitiveDefault =
          isNodeOfType(defaultValue, "Literal") &&
          !("regex" in defaultValue) &&
          !("bigint" in defaultValue) &&
          (defaultValue.value === null ||
            typeof defaultValue.value === "string" ||
            typeof defaultValue.value === "boolean" ||
            typeof defaultValue.value === "number");
        if (
          !primitiveDefault &&
          !(
            isNodeOfType(defaultValue, "ObjectExpression") && defaultValue.properties.length === 0
          ) &&
          !(isNodeOfType(defaultValue, "ArrayExpression") && defaultValue.elements.length === 0)
        )
          return false;
      }
      const binding = isNodeOfType(parameter, "AssignmentPattern") ? parameter.left : parameter;
      const actual = call.arguments[index];
      if (!actual || !isNodeOfType(binding, "Identifier")) return false;
      const symbol = resolved.facts.scopes.symbolFor(binding);
      if (!symbol || !proof.closed(symbol, resolved.facts)) return false;
      bindings.set(symbol, { ...selected, node: actual });
    }
    const forwarded = getSingleReturnExpression(resolved.node);
    if (forwarded)
      return requestCall({
        node: stripParenExpression(forwarded),
        facts: resolved.facts,
        bindings,
      });
    if (!resolved.node.async || !isNodeOfType(resolved.node.body, "BlockStatement")) return false;
    const first = resolved.node.body.body[0];
    if (
      !isNodeOfType(first, "VariableDeclaration") ||
      first.kind !== "const" ||
      first.declarations.length !== 1
    )
      return false;
    const acquired = first.declarations[0]?.init;
    return Boolean(
      isNodeOfType(acquired, "AwaitExpression") &&
      requestCall({ node: acquired.argument, facts: resolved.facts, bindings }),
    );
  };
  return requestCall({ node, facts: proof.caller, bindings: emptyBindings });
};
