import type { EsTreeNode } from "../ast/es-tree-node.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";
import { isBlockReachableFromBlock } from "../analysis/reachability.js";
import { isConstantTruthyTest } from "../constant-condition.js";
import type { BasicBlock } from "../ir/basic-block.js";
import type { TerminalCase } from "../ir/terminal.js";
import {
  addEdge,
  appendInstruction,
  appendNode,
  createBlock,
  mapDescendantsToBlock,
  setTerminal,
} from "./cfg-builder.js";
import type { CfgBuilder } from "./cfg-builder.js";
import {
  buildExpression,
  buildSubExpression,
  containsExpressionControlFlow,
} from "./build-expression.js";

// Returns true if the node introduces internal control flow we want to
// expand into the CFG (rather than treat as a single statement).
const hasInternalControlFlow = (node: EsTreeNode): boolean => {
  switch (node.type) {
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "SwitchStatement":
    case "TryStatement":
    case "ReturnStatement":
    case "ThrowStatement":
    case "BreakStatement":
    case "ContinueStatement":
    case "BlockStatement":
    case "LabeledStatement":
      return true;
    default:
      return false;
  }
};

const findLabel = (
  builder: CfgBuilder,
  name: string | null,
): { merge: BasicBlock; header: BasicBlock | null } | null => {
  if (name === null) {
    // Unlabeled break/continue → innermost loop or switch.
    if (builder.loopStack.length > 0) {
      const top = builder.loopStack[builder.loopStack.length - 1]!;
      return { merge: top.merge, header: top.header };
    }
    if (builder.switchStack.length > 0) {
      const top = builder.switchStack[builder.switchStack.length - 1]!;
      return { merge: top.merge, header: null };
    }
    return null;
  }
  for (let index = builder.labelStack.length - 1; index >= 0; index--) {
    const entry = builder.labelStack[index]!;
    if (entry.label === name) return { merge: entry.merge, header: entry.header };
  }
  return null;
};

// A protected region (the `try` body or a `catch` body) "completes
// normally" iff its end block is reachable from its entry without
// leaving via an exception (`throw`) or diverting into the `finally`
// (`finalize`). `return` / `throw` / `break` route elsewhere and strand
// the region end as an orphan, so it stays unreachable here.
const completesNormally = (regionEntry: BasicBlock, regionEnd: BasicBlock): boolean =>
  regionEntry === regionEnd ||
  isBlockReachableFromBlock(
    regionEntry,
    regionEnd,
    (edge) => edge.kind !== "throw" && edge.kind !== "finalize",
  );

// Process a list of statements inside a block. Returns the block where
// fall-through control flow ends up. Caller is responsible for
// connecting that to the next block (e.g. exit, merge).
export const buildStatements = (
  builder: CfgBuilder,
  statements: ReadonlyArray<EsTreeNode>,
  current: BasicBlock,
): BasicBlock => {
  let cursor = current;
  for (const statement of statements) {
    cursor = buildStatement(builder, statement, cursor);
  }
  return cursor;
};

// Process a single statement. Returns the block where control flow
// ends up after the statement (possibly an orphan if the statement is
// terminating).
export const buildStatement = (
  builder: CfgBuilder,
  statement: EsTreeNode,
  current: BasicBlock,
): BasicBlock => {
  // Tag the statement node itself with the current block before
  // descending — even for control-flow statements, the syntactic
  // statement itself is "in" the current block.
  builder.nodeBlock.set(statement, current);

  if (!hasInternalControlFlow(statement)) {
    appendNode(builder, current, statement);
    // A plain statement can still carry expression-level control flow
    // (`const x = cond ? useA() : useB()`, `cond && setState()`): lower it
    // so the branched sub-expressions land in their own blocks. Otherwise
    // every descendant maps to the current block (cheap path).
    if (containsExpressionControlFlow(statement)) {
      return buildExpression(builder, statement, current);
    }
    mapDescendantsToBlock(builder, statement, current);
    return current;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    return buildStatements(builder, statement.body as EsTreeNode[], current);
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    // Push the label onto the stack with a placeholder; the body will
    // create the merge block for `break <label>`.
    const merge = createBlock(builder);
    const labelEntry = {
      label: statement.label.name,
      merge,
      header: null as BasicBlock | null,
    };
    builder.labelStack.push(labelEntry);
    const body = (statement as { body: EsTreeNode }).body;
    const end = buildStatement(builder, body, current);
    builder.labelStack.pop();
    addEdge(end, merge, "uncond");
    return merge;
  }

  if (isNodeOfType(statement, "ReturnStatement")) {
    const afterArgument = buildSubExpression(
      builder,
      statement.argument as EsTreeNode | null,
      current,
    );
    appendInstruction(afterArgument, statement, "return");
    setTerminal(afterArgument, {
      kind: "return",
      argument: (statement.argument as EsTreeNode | null) ?? null,
    });
    addEdge(afterArgument, builder.exit, "uncond");
    // Any subsequent statement is unreachable; create an orphan.
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "ThrowStatement")) {
    const afterArgument = buildSubExpression(
      builder,
      statement.argument as EsTreeNode | null,
      current,
    );
    // If we're in a try-catch, route to the catch (uncond — it's a
    // normal control-flow successor for our analysis). Otherwise the
    // throw escapes the function: route to exit but tag the edge as
    // "throw" so the unconditional-from-entry analysis can ignore it
    // (rules-of-hooks treats `if (x) throw; useHook();` as
    // unconditional because the throw branch never normally returns).
    appendInstruction(afterArgument, statement, "throw");
    setTerminal(afterArgument, {
      kind: "throw",
      argument: statement.argument as EsTreeNode,
    });
    const top = builder.tryStack[builder.tryStack.length - 1];
    if (top?.catch) {
      addEdge(afterArgument, top.catch, "uncond");
    } else if (top?.finally) {
      addEdge(afterArgument, top.finally, "uncond");
    } else {
      addEdge(afterArgument, builder.exit, "throw");
    }
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "BreakStatement")) {
    const targetLabel = statement.label ? statement.label.name : null;
    const target = findLabel(builder, targetLabel);
    appendInstruction(current, statement, "break");
    const gotoTarget = target ? target.merge : builder.exit;
    addEdge(current, gotoTarget, "uncond");
    setTerminal(current, { kind: "goto", block: gotoTarget, variant: "break" });
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "ContinueStatement")) {
    const targetLabel = statement.label ? statement.label.name : null;
    const target = findLabel(builder, targetLabel);
    appendInstruction(current, statement, "continue");
    if (target?.header) {
      addEdge(current, target.header, "backedge");
      setTerminal(current, { kind: "goto", block: target.header, variant: "continue" });
    }
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "IfStatement")) {
    // Evaluate the test (its own short-circuits, e.g. `if (a && useX())`,
    // become real branches); the if then forks from the post-test block.
    const afterTest = buildSubExpression(builder, statement.test as EsTreeNode, current);
    appendInstruction(afterTest, statement.test as EsTreeNode, "condition");
    const thenBlock = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(afterTest, thenBlock, "cond");
    const thenEnd = buildStatement(builder, statement.consequent as EsTreeNode, thenBlock);
    addEdge(thenEnd, merge, "uncond");
    let alternateBlock = merge;
    if (statement.alternate) {
      alternateBlock = createBlock(builder);
      addEdge(afterTest, alternateBlock, "cond");
      const elseEnd = buildStatement(builder, statement.alternate as EsTreeNode, alternateBlock);
      addEdge(elseEnd, merge, "uncond");
    } else {
      addEdge(afterTest, merge, "cond");
    }
    setTerminal(afterTest, {
      kind: "if",
      test: statement.test as EsTreeNode,
      consequent: thenBlock,
      alternate: alternateBlock,
      fallthrough: merge,
    });
    return merge;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const isDoWhile = isNodeOfType(statement, "DoWhileStatement");
    mapDescendantsToBlock(builder, statement.test as EsTreeNode, current);
    const isInfinite = isConstantTruthyTest(statement.test as EsTreeNode);
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
    appendInstruction(header, statement.test as EsTreeNode, "condition");
    if (isDoWhile) {
      // do-while: enter body first.
      addEdge(current, body, "uncond");
    } else {
      addEdge(current, header, "uncond");
      addEdge(header, body, "cond");
      if (!isInfinite) addEdge(header, merge, "cond");
    }
    builder.loopStack.push({ header, merge, label: null });
    const bodyEnd = buildStatement(builder, statement.body as EsTreeNode, body);
    builder.loopStack.pop();
    if (isDoWhile) {
      // After body, test is evaluated → loop back or merge.
      addEdge(bodyEnd, header, "backedge");
      addEdge(header, body, "cond");
      if (!isInfinite) addEdge(header, merge, "cond");
    } else {
      addEdge(bodyEnd, header, "backedge");
    }
    setTerminal(header, {
      kind: isDoWhile ? "do-while" : "while",
      test: statement.test as EsTreeNode,
      body,
      fallthrough: merge,
    });
    return merge;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    if (statement.init) mapDescendantsToBlock(builder, statement.init as EsTreeNode, current);
    if (statement.test) mapDescendantsToBlock(builder, statement.test as EsTreeNode, current);
    // `for (;;)` (no test) and `for (; true;)` never exit via condition.
    const isInfinite = isConstantTruthyTest(statement.test as EsTreeNode | null);
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(current, header, "uncond");
    addEdge(header, body, "cond");
    if (!isInfinite) addEdge(header, merge, "cond");
    builder.loopStack.push({ header, merge, label: null });
    const bodyEnd = buildStatement(builder, statement.body as EsTreeNode, body);
    builder.loopStack.pop();
    if (statement.update) mapDescendantsToBlock(builder, statement.update as EsTreeNode, header);
    addEdge(bodyEnd, header, "backedge");
    setTerminal(header, { kind: "for", body, fallthrough: merge });
    return merge;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    mapDescendantsToBlock(builder, statement.right as EsTreeNode, current);
    mapDescendantsToBlock(builder, statement.left as EsTreeNode, current);
    // A for-in / for-of iterates a (finite) collection, so the loop can
    // always complete — the header→merge edge stays.
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(current, header, "uncond");
    addEdge(header, body, "cond");
    addEdge(header, merge, "cond");
    builder.loopStack.push({ header, merge, label: null });
    const bodyEnd = buildStatement(builder, statement.body as EsTreeNode, body);
    builder.loopStack.pop();
    addEdge(bodyEnd, header, "backedge");
    setTerminal(header, {
      kind: isNodeOfType(statement, "ForInStatement") ? "for-in" : "for-of",
      body,
      fallthrough: merge,
    });
    return merge;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    const afterDiscriminant = buildSubExpression(
      builder,
      statement.discriminant as EsTreeNode,
      current,
    );
    const merge = createBlock(builder);
    appendInstruction(afterDiscriminant, statement.discriminant as EsTreeNode, "condition");
    builder.switchStack.push({ merge, label: null });
    let previousCaseEnd: BasicBlock | null = null;
    let hasDefault = false;
    const terminalCases: TerminalCase[] = [];
    for (const switchCase of statement.cases) {
      const caseBlock = createBlock(builder);
      addEdge(afterDiscriminant, caseBlock, "cond");
      // Fall-through from previous case (no break) connects to this case.
      if (previousCaseEnd) addEdge(previousCaseEnd, caseBlock, "uncond");
      const caseTest = (switchCase as { test: EsTreeNode | null }).test;
      terminalCases.push({ test: caseTest, block: caseBlock });
      const caseEnd = buildStatements(
        builder,
        (switchCase as { consequent: ReadonlyArray<EsTreeNode> }).consequent,
        caseBlock,
      );
      previousCaseEnd = caseEnd;
      if (caseTest === null) hasDefault = true;
    }
    builder.switchStack.pop();
    if (previousCaseEnd) addEdge(previousCaseEnd, merge, "uncond");
    if (!hasDefault) addEdge(afterDiscriminant, merge, "cond"); // no case matched
    setTerminal(afterDiscriminant, {
      kind: "switch",
      discriminant: statement.discriminant as EsTreeNode,
      cases: terminalCases,
      fallthrough: merge,
    });
    return merge;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    const tryBlock = createBlock(builder);
    const merge = createBlock(builder);
    const catchBlock = statement.handler ? createBlock(builder) : null;
    const finallyBlock = statement.finalizer ? createBlock(builder) : null;
    addEdge(current, tryBlock, "uncond");
    setTerminal(current, {
      kind: "try",
      block: tryBlock,
      handler: catchBlock,
      finalizer: finallyBlock,
      fallthrough: merge,
    });

    // Try body. A throw anywhere inside is modeled by a "cond" edge to
    // catch (conditionally reached, like any branch — keeps catch out of
    // the "every normal path" set without making it dead).
    builder.tryStack.push({ catch: catchBlock, finally: finallyBlock });
    const tryEnd = buildStatements(
      builder,
      (statement.block as { body: ReadonlyArray<EsTreeNode> }).body,
      tryBlock,
    );
    builder.tryStack.pop();
    if (catchBlock) addEdge(tryBlock, catchBlock, "cond");
    const tryCompletesNormally = completesNormally(tryBlock, tryEnd);

    let catchEnd: BasicBlock | null = null;
    if (statement.handler && catchBlock) {
      catchEnd = buildStatement(
        builder,
        (statement.handler as { body: EsTreeNode }).body,
        catchBlock,
      );
    }
    const catchCompletesNormally = catchEnd !== null && completesNormally(catchBlock!, catchEnd);

    // The try STATEMENT can complete normally when its body does, or —
    // if the throw is caught — when the catch body does.
    const protectedCompletesNormally = catchBlock
      ? tryCompletesNormally || catchCompletesNormally
      : tryCompletesNormally;

    if (finallyBlock && statement.finalizer) {
      // `finally` runs on every path through the region — wire it from
      // the region entries so a `return`/`throw` in try/catch can't make
      // it unreachable. Also connect the normal ends so dominance sees
      // the in-order path.
      addEdge(tryBlock, finallyBlock, "finalize");
      if (catchBlock) addEdge(catchBlock, finallyBlock, "finalize");
      if (tryCompletesNormally && tryEnd !== tryBlock) addEdge(tryEnd, finallyBlock, "finalize");
      if (catchEnd && catchCompletesNormally && catchEnd !== catchBlock) {
        addEdge(catchEnd, finallyBlock, "finalize");
      }
      const finallyEnd = buildStatements(
        builder,
        (statement.finalizer as { body: ReadonlyArray<EsTreeNode> }).body,
        finallyBlock,
      );
      // Resume-after-finally: code after the try is reachable only if the
      // protected region could complete normally. (If `finally` itself
      // completes abruptly, `finallyEnd` is an orphan and this join is
      // dead regardless.)
      if (protectedCompletesNormally) addEdge(finallyEnd, merge, "join");
      return merge;
    }

    // No finally: after-try is reached from whichever of try / catch can
    // complete normally.
    if (tryCompletesNormally) addEdge(tryEnd, merge, "uncond");
    if (catchEnd && catchCompletesNormally) addEdge(catchEnd, merge, "uncond");
    return merge;
  }

  // Fallback (unhandled control-flow construct): treat as plain.
  appendNode(builder, current, statement);
  mapDescendantsToBlock(builder, statement, current);
  return current;
};
