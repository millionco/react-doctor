import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  addPatternBindings,
  collectScopedReferenceNames,
  createBlockBindingScope,
  createComponentBindingScope,
  getVariableDeclarationScope,
  type BindingScope,
} from "./scope-aware-reference-names.js";

const addNames = (into: Set<string>, names: Set<string>): void => {
  for (const name of names) into.add(name);
};

const addDeclarationBindings = (statement: EsTreeNode, scope: BindingScope): void => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    const declarationScope = getVariableDeclarationScope(statement, scope);
    for (const declarator of statement.declarations ?? []) {
      addPatternBindings(declarator.id, declarationScope);
    }
    return;
  }
  if (isNodeOfType(statement, "FunctionDeclaration") && statement.id) {
    addPatternBindings(statement.id, scope);
  }
};

const collectRenderReachableNamesFromStatements = (
  statements: EsTreeNode[] | undefined,
  names: Set<string>,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string> = new Set(),
): boolean => {
  let hasReturn = false;
  for (const statement of statements ?? []) {
    if (
      collectRenderReachableNamesFromStatement(statement, names, scope, eventHandlerReferenceNames)
    ) {
      hasReturn = true;
    } else {
      addDeclarationBindings(statement, scope);
    }
  }
  return hasReturn;
};

const collectRenderReachableNamesFromStatement = (
  statement: EsTreeNode,
  names: Set<string>,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): boolean => {
  if (isNodeOfType(statement, "ReturnStatement")) {
    if (statement.argument) {
      addNames(
        names,
        collectScopedReferenceNames(statement.argument, scope, eventHandlerReferenceNames),
      );
    }
    return true;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    return collectRenderReachableNamesFromStatements(
      statement.body,
      names,
      createBlockBindingScope(scope),
      eventHandlerReferenceNames,
    );
  }

  if (isNodeOfType(statement, "IfStatement")) {
    const consequentHasReturn = collectRenderReachableNamesFromStatement(
      statement.consequent,
      names,
      scope,
      eventHandlerReferenceNames,
    );
    const alternateHasReturn = statement.alternate
      ? collectRenderReachableNamesFromStatement(
          statement.alternate,
          names,
          scope,
          eventHandlerReferenceNames,
        )
      : false;
    if (consequentHasReturn || alternateHasReturn) {
      addNames(
        names,
        collectScopedReferenceNames(statement.test, scope, eventHandlerReferenceNames),
      );
    }
    return consequentHasReturn || alternateHasReturn;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    let hasReturn = false;
    for (const switchCase of statement.cases ?? []) {
      const caseScope = createBlockBindingScope(scope);
      const caseHasReturn = collectRenderReachableNamesFromStatements(
        switchCase.consequent,
        names,
        caseScope,
        eventHandlerReferenceNames,
      );
      if (!caseHasReturn) continue;
      hasReturn = true;
      if (switchCase.test) {
        addNames(
          names,
          collectScopedReferenceNames(switchCase.test, scope, eventHandlerReferenceNames),
        );
      }
    }
    if (hasReturn) {
      addNames(
        names,
        collectScopedReferenceNames(statement.discriminant, scope, eventHandlerReferenceNames),
      );
    }
    return hasReturn;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    const blockHasReturn = collectRenderReachableNamesFromStatement(
      statement.block,
      names,
      scope,
      eventHandlerReferenceNames,
    );
    const handlerHasReturn = statement.handler
      ? collectRenderReachableNamesFromStatement(
          statement.handler,
          names,
          scope,
          eventHandlerReferenceNames,
        )
      : false;
    const finalizerHasReturn = statement.finalizer
      ? collectRenderReachableNamesFromStatement(
          statement.finalizer,
          names,
          scope,
          eventHandlerReferenceNames,
        )
      : false;
    return blockHasReturn || handlerHasReturn || finalizerHasReturn;
  }

  if (isNodeOfType(statement, "CatchClause")) {
    const catchScope = createBlockBindingScope(scope);
    addPatternBindings(statement.param, catchScope);
    return collectRenderReachableNamesFromStatement(
      statement.body,
      names,
      catchScope,
      eventHandlerReferenceNames,
    );
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const bodyHasReturn = collectRenderReachableNamesFromStatement(
      statement.body,
      names,
      scope,
      eventHandlerReferenceNames,
    );
    if (bodyHasReturn) {
      addNames(
        names,
        collectScopedReferenceNames(statement.test, scope, eventHandlerReferenceNames),
      );
    }
    return bodyHasReturn;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const loopScope = createBlockBindingScope(scope);
    if (statement.init) addDeclarationBindings(statement.init, loopScope);
    const bodyHasReturn = collectRenderReachableNamesFromStatement(
      statement.body,
      names,
      loopScope,
      eventHandlerReferenceNames,
    );
    if (!bodyHasReturn) return false;
    if (statement.init) {
      addNames(
        names,
        collectScopedReferenceNames(statement.init, loopScope, eventHandlerReferenceNames),
      );
    }
    if (statement.test) {
      addNames(
        names,
        collectScopedReferenceNames(statement.test, loopScope, eventHandlerReferenceNames),
      );
    }
    if (statement.update) {
      addNames(
        names,
        collectScopedReferenceNames(statement.update, loopScope, eventHandlerReferenceNames),
      );
    }
    return true;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const rightNames = collectScopedReferenceNames(
      statement.right,
      scope,
      eventHandlerReferenceNames,
    );
    const loopScope = createBlockBindingScope(scope);
    if (isNodeOfType(statement.left, "VariableDeclaration")) {
      addDeclarationBindings(statement.left, loopScope);
    }
    const bodyHasReturn = collectRenderReachableNamesFromStatement(
      statement.body,
      names,
      loopScope,
      eventHandlerReferenceNames,
    );
    if (!bodyHasReturn) return false;
    addNames(names, rightNames);
    return true;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    return collectRenderReachableNamesFromStatement(
      statement.body,
      names,
      scope,
      eventHandlerReferenceNames,
    );
  }

  if (isNodeOfType(statement, "WithStatement")) {
    const bodyHasReturn = collectRenderReachableNamesFromStatement(
      statement.body,
      names,
      scope,
      eventHandlerReferenceNames,
    );
    if (bodyHasReturn) {
      addNames(
        names,
        collectScopedReferenceNames(statement.object, scope, eventHandlerReferenceNames),
      );
    }
    return bodyHasReturn;
  }

  return false;
};

export const collectRenderReachableNames = (
  componentBody: EsTreeNode,
  eventHandlerReferenceNames: Set<string> = new Set(),
): Set<string> => {
  const names = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return names;
  collectRenderReachableNamesFromStatements(
    componentBody.body,
    names,
    createComponentBindingScope(),
    eventHandlerReferenceNames,
  );
  return names;
};
