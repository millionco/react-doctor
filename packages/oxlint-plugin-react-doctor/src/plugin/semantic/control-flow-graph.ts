import type { EsTreeNode } from "../utils/es-tree-node.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";

// Per-function CFG. Mirrors the subset of `oxc_cfg` we need to answer:
// "Is this AST node guaranteed to execute on every call to its
// enclosing function?" (isUnconditionalFromEntry — used by rules-of-hooks)
//
// Edge kinds, mapped from oxc_cfg's richer `EdgeType` taxonomy to the
// distinctions our analyses actually consume:
//   uncond   — sequential fall-through (oxc `Normal`)
//   cond     — a conditional branch: true / false / loop-enter / case
//              (oxc `Jump` + the `Normal` else-arm; we don't split them
//              because reachability/dominance weight every edge equally)
//   backedge — a loop's back-edge to its header (oxc `Backedge`); the
//              sole creator of cycles, so loop detection keys off it
//   throw    — an exception path to a catch/finally or the function exit
//              (oxc `Error`); excluded from "normal completion" reachability
//   finalize — entry into a `finally` block, taken on every path through
//              the protected region — even a `return`/`throw` in `try`
//              (oxc `Finalize`). An abrupt completion can't sever it, so
//              the `finally` body stays reachable.
//   join     — the normal continuation after a `finally` completes, added
//              only when the protected region can itself complete normally
//              (oxc `Join`). Its absence is what makes code after
//              `try { return } finally { … }` unreachable.
// oxc's `NewFunction` edge is absent by construction: every function gets
// its own CFG here, so reachability never crosses a function boundary.
export type CfgEdgeKind = "uncond" | "cond" | "throw" | "backedge" | "finalize" | "join";

export interface CfgEdge {
  readonly from: BasicBlock;
  readonly to: BasicBlock;
  readonly kind: CfgEdgeKind;
}

export interface BasicBlock {
  readonly id: number;
  readonly nodes: EsTreeNode[];
  readonly successors: CfgEdge[];
  readonly predecessors: CfgEdge[];
}

export interface FunctionCfg {
  readonly owner: EsTreeNode;
  readonly entry: BasicBlock;
  readonly exit: BasicBlock;
  readonly blocks: BasicBlock[];
  readonly blockOf: (node: EsTreeNode) => BasicBlock | null;
}

export interface ControlFlowAnalysis {
  readonly cfgFor: (functionLike: EsTreeNode) => FunctionCfg | null;
  readonly enclosingFunction: (node: EsTreeNode) => EsTreeNode | null;
  // On every path from the enclosing function's entry to its exit.
  readonly isUnconditionalFromEntry: (node: EsTreeNode) => boolean;
  // Some control-flow path lets execution flow from `fromNode` to
  // `toNode` within the same enclosing function. Cross-function pairs
  // are never reachable.
  readonly isReachable: (fromNode: EsTreeNode, toNode: EsTreeNode) => boolean;
  // `aNode` executes on EVERY path that reaches `bNode` (graph
  // dominance). A guard that dominates a sink runs before it on every
  // path.
  readonly dominates: (aNode: EsTreeNode, bNode: EsTreeNode) => boolean;
  // `bNode` executes on EVERY path from `aNode` to the function exit
  // (graph post-dominance). A cleanup that post-dominates a
  // subscription always runs after it.
  readonly postDominates: (bNode: EsTreeNode, aNode: EsTreeNode) => boolean;
  // The node's basic block is part of a cycle in ITS OWN function's CFG
  // — i.e. it executes once per iteration of an enclosing loop. A node
  // inside a callback that merely escapes a loop is NOT inside the loop
  // (the callback is a separate function with its own acyclic CFG).
  readonly isInsideLoop: (node: EsTreeNode) => boolean;
  // The node's block is not reachable from the function entry (dead
  // code after an unconditional return / throw / break).
  readonly isUnreachable: (node: EsTreeNode) => boolean;
}

interface CfgBuilder {
  blocks: BasicBlock[];
  entry: BasicBlock;
  exit: BasicBlock;
  // Map every AST node visited inside this function to the block it
  // was appended to.
  nodeBlock: Map<EsTreeNode, BasicBlock>;
  // Stack of "loop-merge" / "loop-header" pairs for break/continue.
  loopStack: Array<{ header: BasicBlock; merge: BasicBlock; label: string | null }>;
  // Stack of "switch-merge" + label, for break in switches.
  switchStack: Array<{ merge: BasicBlock; label: string | null }>;
  // Stack of try-catch contexts: where to route ThrowStatement to.
  tryStack: Array<{ catch: BasicBlock | null; finally: BasicBlock | null }>;
  // Labels currently in scope: maps label name → loop/switch entry.
  labelStack: Array<{ label: string; merge: BasicBlock; header: BasicBlock | null }>;
}

let nextBlockId = 0;

const createBlock = (builder: CfgBuilder): BasicBlock => {
  const block: BasicBlock = {
    id: nextBlockId++,
    nodes: [],
    successors: [],
    predecessors: [],
  };
  builder.blocks.push(block);
  return block;
};

const addEdge = (from: BasicBlock, to: BasicBlock, kind: CfgEdgeKind): void => {
  const edge: CfgEdge = { from, to, kind };
  from.successors.push(edge);
  to.predecessors.push(edge);
};

const appendNode = (builder: CfgBuilder, block: BasicBlock, node: EsTreeNode): void => {
  block.nodes.push(node);
  if (!builder.nodeBlock.has(node)) {
    builder.nodeBlock.set(node, block);
  }
  // Walk all descendants attaching them to the same block UNLESS they
  // would open a control-flow construct (those will get their own
  // block treatment when buildStatement reaches them).
  // We rely on the structured walker — appendNode only handles the
  // node itself; the recursive descent happens inside buildStatement.
};

// Recursively map every descendant of `node` to `block`, EXCEPT when
// crossing a function boundary (inner functions get their own CFG).
const mapDescendantsToBlock = (builder: CfgBuilder, node: EsTreeNode, block: BasicBlock): void => {
  builder.nodeBlock.set(node, block);
  if (isFunctionLike(node)) return;
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "parent") continue;
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) if (isAstNode(item)) mapDescendantsToBlock(builder, item, block);
    } else if (isAstNode(child)) {
      mapDescendantsToBlock(builder, child, block);
    }
  }
};

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
  for (let i = builder.labelStack.length - 1; i >= 0; i--) {
    const entry = builder.labelStack[i]!;
    if (entry.label === name) return { merge: entry.merge, header: entry.header };
  }
  return null;
};

// A loop whose test is a compile-time truthy constant (`while (true)`,
// `do … while (1)`) — or a `for (;;)` with no test at all — never exits
// through its condition. We model that by omitting the header→merge
// "cond" edge, so code after the loop is reachable only via an explicit
// `break` (matching oxc's infinite-loop handling, which is what makes
// `while (true) {} after();` flag `after()` as unreachable).
const isAlwaysTruthyLoopTest = (test: EsTreeNode | null | undefined): boolean => {
  if (!test) return true;
  if (isNodeOfType(test, "Literal")) {
    const literalValue = (test as { value?: unknown }).value;
    if (typeof literalValue === "boolean") return literalValue;
    if (typeof literalValue === "number") return literalValue !== 0;
    if (typeof literalValue === "string") return literalValue.length > 0;
    if (typeof literalValue === "bigint") return literalValue !== BigInt(0);
  }
  return false;
};

// Process a list of statements inside a block. Returns the block where
// fall-through control flow ends up. Caller is responsible for
// connecting that to the next block (e.g. exit, merge).
const buildStatements = (
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
const buildStatement = (
  builder: CfgBuilder,
  statement: EsTreeNode,
  current: BasicBlock,
): BasicBlock => {
  // Tag the statement node itself with the current block before
  // descending — even for control-flow statements, the syntactic
  // statement itself is "in" the current block.
  builder.nodeBlock.set(statement, current);

  if (!hasInternalControlFlow(statement)) {
    // Plain statement: every descendant maps to the current block.
    appendNode(builder, current, statement);
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
    if (statement.argument) {
      mapDescendantsToBlock(builder, statement.argument as EsTreeNode, current);
    }
    addEdge(current, builder.exit, "uncond");
    // Any subsequent statement is unreachable; create an orphan.
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "ThrowStatement")) {
    if (statement.argument) {
      mapDescendantsToBlock(builder, statement.argument as EsTreeNode, current);
    }
    // If we're in a try-catch, route to the catch (uncond — it's a
    // normal control-flow successor for our analysis). Otherwise the
    // throw escapes the function: route to exit but tag the edge as
    // "throw" so the unconditional-from-entry analysis can ignore it
    // (rules-of-hooks treats `if (x) throw; useHook();` as
    // unconditional because the throw branch never normally returns).
    const top = builder.tryStack[builder.tryStack.length - 1];
    if (top?.catch) {
      addEdge(current, top.catch, "uncond");
    } else if (top?.finally) {
      addEdge(current, top.finally, "uncond");
    } else {
      addEdge(current, builder.exit, "throw");
    }
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "BreakStatement")) {
    const targetLabel = statement.label ? statement.label.name : null;
    const target = findLabel(builder, targetLabel);
    if (target) addEdge(current, target.merge, "uncond");
    else addEdge(current, builder.exit, "uncond");
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "ContinueStatement")) {
    const targetLabel = statement.label ? statement.label.name : null;
    const target = findLabel(builder, targetLabel);
    if (target?.header) addEdge(current, target.header, "backedge");
    return createBlock(builder);
  }

  if (isNodeOfType(statement, "IfStatement")) {
    // Map the test expression to the current block.
    mapDescendantsToBlock(builder, statement.test as EsTreeNode, current);
    const thenBlock = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(current, thenBlock, "cond");
    const thenEnd = buildStatement(builder, statement.consequent as EsTreeNode, thenBlock);
    addEdge(thenEnd, merge, "uncond");
    if (statement.alternate) {
      const elseBlock = createBlock(builder);
      addEdge(current, elseBlock, "cond");
      const elseEnd = buildStatement(builder, statement.alternate as EsTreeNode, elseBlock);
      addEdge(elseEnd, merge, "uncond");
    } else {
      addEdge(current, merge, "cond");
    }
    return merge;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const isDoWhile = isNodeOfType(statement, "DoWhileStatement");
    mapDescendantsToBlock(builder, statement.test as EsTreeNode, current);
    const isInfinite = isAlwaysTruthyLoopTest(statement.test as EsTreeNode);
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
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
    return merge;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    if (statement.init) mapDescendantsToBlock(builder, statement.init as EsTreeNode, current);
    if (statement.test) mapDescendantsToBlock(builder, statement.test as EsTreeNode, current);
    // `for (;;)` (no test) and `for (; true;)` never exit via condition.
    const isInfinite = isAlwaysTruthyLoopTest(statement.test as EsTreeNode | null);
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
    return merge;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    mapDescendantsToBlock(builder, statement.discriminant as EsTreeNode, current);
    const merge = createBlock(builder);
    builder.switchStack.push({ merge, label: null });
    let previousCaseEnd: BasicBlock | null = null;
    let hasDefault = false;
    for (const switchCase of statement.cases) {
      const caseBlock = createBlock(builder);
      addEdge(current, caseBlock, "cond");
      // Fall-through from previous case (no break) connects to this case.
      if (previousCaseEnd) addEdge(previousCaseEnd, caseBlock, "uncond");
      const caseEnd = buildStatements(
        builder,
        (switchCase as { consequent: ReadonlyArray<EsTreeNode> }).consequent,
        caseBlock,
      );
      previousCaseEnd = caseEnd;
      if ((switchCase as { test: EsTreeNode | null }).test === null) hasDefault = true;
    }
    builder.switchStack.pop();
    if (previousCaseEnd) addEdge(previousCaseEnd, merge, "uncond");
    if (!hasDefault) addEdge(current, merge, "cond"); // no case matched
    return merge;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    const tryBlock = createBlock(builder);
    const merge = createBlock(builder);
    const catchBlock = statement.handler ? createBlock(builder) : null;
    const finallyBlock = statement.finalizer ? createBlock(builder) : null;
    addEdge(current, tryBlock, "uncond");

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

const buildFunctionCfg = (functionNode: EsTreeNode, body: EsTreeNode): FunctionCfg => {
  const builder: CfgBuilder = {
    blocks: [],
    entry: null as unknown as BasicBlock,
    exit: null as unknown as BasicBlock,
    nodeBlock: new Map(),
    loopStack: [],
    switchStack: [],
    tryStack: [],
    labelStack: [],
  };
  const entry = createBlock(builder);
  const exit = createBlock(builder);
  builder.entry = entry;
  builder.exit = exit;

  let bodyEnd: BasicBlock;
  if (isNodeOfType(body, "BlockStatement")) {
    bodyEnd = buildStatements(builder, body.body as EsTreeNode[], entry);
  } else {
    // Arrow expression body: a single Expression
    mapDescendantsToBlock(builder, body, entry);
    bodyEnd = entry;
  }
  // Implicit return / fall-off the end of the function body.
  addEdge(bodyEnd, exit, "uncond");

  const blockOf = (node: EsTreeNode): BasicBlock | null => builder.nodeBlock.get(node) ?? null;

  return {
    owner: functionNode,
    entry,
    exit,
    blocks: builder.blocks,
    blockOf,
  };
};

// A block B is "unconditional from entry" iff every execution path
// from entry to exit passes through B. We compute this by, for each
// block B, asking: if we removed B from the graph, is exit still
// reachable from entry? If NO, B is on every path → unconditional.
//
// Cost: O(|blocks|^2) — fine for function-sized CFGs (typically <100
// blocks). Avoids needing a full dominator tree.
const computeUnconditionalSet = (cfg: FunctionCfg): Set<BasicBlock> => {
  // Skip "throw" edges when computing reachability — uncaught throws
  // don't represent a normal completion path. This makes
  // `if (x) throw; useHook();` evaluate as unconditional (the
  // `useHook` block is the only normal path to exit).
  const reachableFromEntry = (excluded: BasicBlock | null): Set<BasicBlock> => {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    if (cfg.entry !== excluded) queue.push(cfg.entry);
    while (queue.length > 0) {
      const block = queue.shift()!;
      if (visited.has(block)) continue;
      visited.add(block);
      for (const edge of block.successors) {
        if (edge.kind === "throw") continue;
        if (edge.to === excluded) continue;
        queue.push(edge.to);
      }
    }
    return visited;
  };

  // Whole-graph reachability: any block NOT in this set is dead code
  // (e.g. statements after an unconditional `return;` / `throw;`).
  // Dead-code blocks vacuously satisfy "unconditional from entry"
  // because the call site is never reached at runtime — there's
  // nothing to constrain.
  const reachableFromEntryFull = reachableFromEntry(null);

  const unconditional = new Set<BasicBlock>();
  // Entry is trivially on every path.
  unconditional.add(cfg.entry);
  // Exit is on every (terminating) path.
  unconditional.add(cfg.exit);
  for (const block of cfg.blocks) {
    if (unconditional.has(block)) continue;
    if (!reachableFromEntryFull.has(block)) {
      unconditional.add(block);
      continue;
    }
    const stillReaches = reachableFromEntry(block).has(cfg.exit);
    if (!stillReaches) unconditional.add(block);
  }
  return unconditional;
};

// Blocks reachable from entry over EVERY edge kind (including catch
// edges). Used to answer `isUnreachable` — a block with no path from
// entry is dead code.
const computeReachableFromEntry = (cfg: FunctionCfg): Set<BasicBlock> => {
  const visited = new Set<BasicBlock>();
  const queue: BasicBlock[] = [cfg.entry];
  while (queue.length > 0) {
    const block = queue.shift()!;
    if (visited.has(block)) continue;
    visited.add(block);
    for (const edge of block.successors) queue.push(edge.to);
  }
  return visited;
};

// Standard iterative dominator dataflow: dom(entry) = {entry};
// dom(b) = {b} ∪ (⋂ dom(p) for predecessors p). `a` dominates `b` iff
// `a ∈ dom(b)`. O(blocks²) — fine for function-sized graphs.
const computeDominators = (cfg: FunctionCfg): Map<BasicBlock, Set<BasicBlock>> => {
  const dominators = new Map<BasicBlock, Set<BasicBlock>>();
  for (const block of cfg.blocks) {
    dominators.set(block, block === cfg.entry ? new Set([cfg.entry]) : new Set(cfg.blocks));
  }
  let didChange = true;
  while (didChange) {
    didChange = false;
    for (const block of cfg.blocks) {
      if (block === cfg.entry) continue;
      let intersection: Set<BasicBlock> | null = null;
      for (const edge of block.predecessors) {
        const predecessorDominators = dominators.get(edge.from)!;
        if (intersection === null) {
          intersection = new Set(predecessorDominators);
        } else {
          for (const candidate of intersection) {
            if (!predecessorDominators.has(candidate)) intersection.delete(candidate);
          }
        }
      }
      const nextDominators = intersection ?? new Set<BasicBlock>();
      nextDominators.add(block);
      const previousDominators = dominators.get(block)!;
      if (!areSetsEqual(previousDominators, nextDominators)) {
        dominators.set(block, nextDominators);
        didChange = true;
      }
    }
  }
  return dominators;
};

// Post-dominators are dominators on the reversed graph: postDom(exit) =
// {exit}; postDom(b) = {b} ∪ (⋂ postDom(s) for successors s). `b`
// post-dominates `a` iff `b ∈ postDom(a)`.
const computePostDominators = (cfg: FunctionCfg): Map<BasicBlock, Set<BasicBlock>> => {
  const postDominators = new Map<BasicBlock, Set<BasicBlock>>();
  for (const block of cfg.blocks) {
    postDominators.set(block, block === cfg.exit ? new Set([cfg.exit]) : new Set(cfg.blocks));
  }
  let didChange = true;
  while (didChange) {
    didChange = false;
    for (const block of cfg.blocks) {
      if (block === cfg.exit) continue;
      let intersection: Set<BasicBlock> | null = null;
      for (const edge of block.successors) {
        const successorPostDominators = postDominators.get(edge.to)!;
        if (intersection === null) {
          intersection = new Set(successorPostDominators);
        } else {
          for (const candidate of intersection) {
            if (!successorPostDominators.has(candidate)) intersection.delete(candidate);
          }
        }
      }
      const nextPostDominators = intersection ?? new Set<BasicBlock>();
      nextPostDominators.add(block);
      const previousPostDominators = postDominators.get(block)!;
      if (!areSetsEqual(previousPostDominators, nextPostDominators)) {
        postDominators.set(block, nextPostDominators);
        didChange = true;
      }
    }
  }
  return postDominators;
};

// A block is on a cycle iff it can reach itself by following non-throw
// successor edges (loop back-edges are normal "uncond" edges; a
// throw→catch edge is not a loop).
const computeCyclicBlocks = (cfg: FunctionCfg): Set<BasicBlock> => {
  const cyclicBlocks = new Set<BasicBlock>();
  for (const startBlock of cfg.blocks) {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    for (const edge of startBlock.successors) {
      if (edge.kind !== "throw") queue.push(edge.to);
    }
    let isOnCycle = false;
    while (queue.length > 0) {
      const block = queue.shift()!;
      if (block === startBlock) {
        isOnCycle = true;
        break;
      }
      if (visited.has(block)) continue;
      visited.add(block);
      for (const edge of block.successors) {
        if (edge.kind !== "throw") queue.push(edge.to);
      }
    }
    if (isOnCycle) cyclicBlocks.add(startBlock);
  }
  return cyclicBlocks;
};

// Source-order index for every node owned by this function (not
// descending into nested functions). Used to break ties for two nodes
// that share a basic block: within a straight-line block the earlier
// node dominates the later one.
const computeNodeOrder = (functionNode: EsTreeNode, body: EsTreeNode): Map<EsTreeNode, number> => {
  const nodeOrder = new Map<EsTreeNode, number>();
  let nextOrder = 0;
  const walk = (node: EsTreeNode): void => {
    if (!nodeOrder.has(node)) nodeOrder.set(node, nextOrder++);
    if (node !== functionNode && isFunctionLike(node)) return;
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) walk(item);
      } else if (isAstNode(child)) {
        walk(child);
      }
    }
  };
  walk(body);
  return nodeOrder;
};

const areSetsEqual = <Value>(first: Set<Value>, second: Set<Value>): boolean => {
  if (first.size !== second.size) return false;
  for (const value of first) if (!second.has(value)) return false;
  return true;
};

const isBlockReachableFromBlock = (
  fromBlock: BasicBlock,
  toBlock: BasicBlock,
  includeEdge: (edge: CfgEdge) => boolean = () => true,
): boolean => {
  const visited = new Set<BasicBlock>();
  const queue: BasicBlock[] = [fromBlock];
  while (queue.length > 0) {
    const block = queue.shift()!;
    for (const edge of block.successors) {
      if (!includeEdge(edge)) continue;
      if (edge.to === toBlock) return true;
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
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

interface FunctionCfgEntry {
  cfg: FunctionCfg;
  unconditionalSet: Set<BasicBlock>;
  dominators: Map<BasicBlock, Set<BasicBlock>>;
  postDominators: Map<BasicBlock, Set<BasicBlock>>;
  cyclicBlocks: Set<BasicBlock>;
  reachableFromEntry: Set<BasicBlock>;
  nodeOrder: Map<EsTreeNode, number>;
}

// Walks the AST building a CFG for every function-like node + the
// program. Lookups for an arbitrary AST node find the enclosing
// function and consult that function's CFG.
export const analyzeControlFlow = (program: EsTreeNode): ControlFlowAnalysis => {
  nextBlockId = 0;
  const functionCfgs = new Map<EsTreeNode, FunctionCfgEntry>();

  const buildFor = (functionNode: EsTreeNode, body: EsTreeNode): void => {
    const cfg = buildFunctionCfg(functionNode, body);
    functionCfgs.set(functionNode, {
      cfg,
      unconditionalSet: computeUnconditionalSet(cfg),
      dominators: computeDominators(cfg),
      postDominators: computePostDominators(cfg),
      cyclicBlocks: computeCyclicBlocks(cfg),
      reachableFromEntry: computeReachableFromEntry(cfg),
      nodeOrder: computeNodeOrder(functionNode, body),
    });
  };

  // Build CFG for the program itself (treat as a "function" for
  // top-level reasoning).
  if (isNodeOfType(program, "Program")) {
    // Synthesize a body block matching BlockStatement shape so
    // buildFunctionCfg can iterate it.
    const synthBody = { type: "BlockStatement", body: program.body } as unknown as EsTreeNode;
    buildFor(program, synthBody);
    // Also walk into every nested function-like node and build its own CFG.
  }

  // Walk every function-like node, build its CFG.
  const visit = (node: EsTreeNode): void => {
    if (isFunctionLike(node)) {
      const body = (node as { body: EsTreeNode }).body;
      if (body) buildFor(node, body);
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(program);

  const enclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
    let current: EsTreeNode | null | undefined = node;
    while (current) {
      if (isFunctionLike(current)) return current;
      if (isNodeOfType(current, "Program")) return current;
      current = current.parent ?? null;
    }
    return null;
  };

  const cfgFor = (functionLike: EsTreeNode): FunctionCfg | null => {
    return functionCfgs.get(functionLike)?.cfg ?? null;
  };

  const isUnconditionalFromEntry = (node: EsTreeNode): boolean => {
    const owner = enclosingFunction(node);
    if (!owner) return true;
    const entry = functionCfgs.get(owner);
    if (!entry) return true;
    const block = entry.cfg.blockOf(node);
    if (!block) return true;
    return entry.unconditionalSet.has(block);
  };

  interface LocatedNode {
    owner: EsTreeNode;
    entry: FunctionCfgEntry;
    block: BasicBlock;
  }

  const locate = (node: EsTreeNode): LocatedNode | null => {
    const owner = enclosingFunction(node);
    if (!owner) return null;
    const entry = functionCfgs.get(owner);
    if (!entry) return null;
    const block = entry.cfg.blockOf(node);
    if (!block) return null;
    return { owner, entry, block };
  };

  const isReachable = (fromNode: EsTreeNode, toNode: EsTreeNode): boolean => {
    const from = locate(fromNode);
    const to = locate(toNode);
    if (!from || !to || from.owner !== to.owner) return false;
    if (from.block === to.block) {
      if (from.entry.cyclicBlocks.has(from.block)) return true;
      const fromOrder = from.entry.nodeOrder.get(fromNode) ?? 0;
      const toOrder = to.entry.nodeOrder.get(toNode) ?? 0;
      return fromOrder <= toOrder;
    }
    return isBlockReachableFromBlock(from.block, to.block);
  };

  const dominates = (aNode: EsTreeNode, bNode: EsTreeNode): boolean => {
    const dominator = locate(aNode);
    const dominated = locate(bNode);
    if (!dominator || !dominated || dominator.owner !== dominated.owner) return false;
    if (dominator.block === dominated.block) {
      const aOrder = dominator.entry.nodeOrder.get(aNode) ?? 0;
      const bOrder = dominated.entry.nodeOrder.get(bNode) ?? 0;
      return aOrder <= bOrder;
    }
    return dominated.entry.dominators.get(dominated.block)?.has(dominator.block) ?? false;
  };

  const postDominates = (bNode: EsTreeNode, aNode: EsTreeNode): boolean => {
    const postDominator = locate(bNode);
    const postDominated = locate(aNode);
    if (!postDominator || !postDominated || postDominator.owner !== postDominated.owner) {
      return false;
    }
    if (postDominator.block === postDominated.block) {
      const bOrder = postDominator.entry.nodeOrder.get(bNode) ?? 0;
      const aOrder = postDominated.entry.nodeOrder.get(aNode) ?? 0;
      return bOrder >= aOrder;
    }
    return (
      postDominated.entry.postDominators.get(postDominated.block)?.has(postDominator.block) ?? false
    );
  };

  const isInsideLoop = (node: EsTreeNode): boolean => {
    const located = locate(node);
    if (!located) return false;
    return located.entry.cyclicBlocks.has(located.block);
  };

  const isUnreachable = (node: EsTreeNode): boolean => {
    const located = locate(node);
    if (!located) return false;
    return !located.entry.reachableFromEntry.has(located.block);
  };

  return {
    cfgFor,
    enclosingFunction,
    isUnconditionalFromEntry,
    isReachable,
    dominates,
    postDominates,
    isInsideLoop,
    isUnreachable,
  };
};
