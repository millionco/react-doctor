import type { EsTreeNode } from "../utils/es-tree-node.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";

// Per-function CFG. Mirrors the subset of `oxc_cfg` we need to answer:
// "Is this AST node guaranteed to execute on every call to its
// enclosing function?" (isUnconditionalFromEntry — used by rules-of-hooks)
//
// Edges have just two kinds: uncond (sequential fall-through) and cond
// (any conditional branch — true / false / loop / case / etc.). The
// finer-grained edge taxonomy in oxc_cfg matters for analyses we don't
// run (e.g. dominator construction in the IR optimizer); for
// rules-of-hooks the binary distinction is sufficient.

export type CfgEdgeKind = "uncond" | "cond" | "throw";

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
  readonly isUnconditionalFromEntry: (node: EsTreeNode) => boolean;
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
    if (target?.header) addEdge(current, target.header, "uncond");
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
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
    if (isDoWhile) {
      // do-while: enter body first.
      addEdge(current, body, "uncond");
    } else {
      addEdge(current, header, "uncond");
      addEdge(header, body, "cond");
      addEdge(header, merge, "cond");
    }
    builder.loopStack.push({ header, merge, label: null });
    const bodyEnd = buildStatement(builder, statement.body as EsTreeNode, body);
    builder.loopStack.pop();
    if (isDoWhile) {
      // After body, test is evaluated → loop back or merge.
      addEdge(bodyEnd, header, "uncond");
      addEdge(header, body, "cond");
      addEdge(header, merge, "cond");
    } else {
      addEdge(bodyEnd, header, "uncond");
    }
    return merge;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    if (statement.init) mapDescendantsToBlock(builder, statement.init as EsTreeNode, current);
    if (statement.test) mapDescendantsToBlock(builder, statement.test as EsTreeNode, current);
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(current, header, "uncond");
    addEdge(header, body, "cond");
    addEdge(header, merge, "cond");
    builder.loopStack.push({ header, merge, label: null });
    const bodyEnd = buildStatement(builder, statement.body as EsTreeNode, body);
    builder.loopStack.pop();
    if (statement.update) mapDescendantsToBlock(builder, statement.update as EsTreeNode, header);
    addEdge(bodyEnd, header, "uncond");
    return merge;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    mapDescendantsToBlock(builder, statement.right as EsTreeNode, current);
    mapDescendantsToBlock(builder, statement.left as EsTreeNode, current);
    const header = createBlock(builder);
    const body = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(current, header, "uncond");
    addEdge(header, body, "cond");
    addEdge(header, merge, "cond");
    builder.loopStack.push({ header, merge, label: null });
    const bodyEnd = buildStatement(builder, statement.body as EsTreeNode, body);
    builder.loopStack.pop();
    addEdge(bodyEnd, header, "uncond");
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
    let catchBlock: BasicBlock | null = null;
    let finallyBlock: BasicBlock | null = null;
    if (statement.handler) catchBlock = createBlock(builder);
    if (statement.finalizer) finallyBlock = createBlock(builder);
    addEdge(current, tryBlock, "uncond");
    builder.tryStack.push({ catch: catchBlock, finally: finallyBlock });
    const tryEnd = buildStatements(
      builder,
      (statement.block as { body: ReadonlyArray<EsTreeNode> }).body,
      tryBlock,
    );
    builder.tryStack.pop();
    // Try block can throw at any point — model with a cond edge to catch.
    if (catchBlock) addEdge(tryBlock, catchBlock, "cond");
    if (statement.handler && catchBlock) {
      const handlerBody = (statement.handler as { body: EsTreeNode }).body;
      const catchEnd = buildStatement(builder, handlerBody, catchBlock);
      if (finallyBlock) addEdge(catchEnd, finallyBlock, "uncond");
      else addEdge(catchEnd, merge, "uncond");
    }
    if (finallyBlock && statement.finalizer) {
      addEdge(tryEnd, finallyBlock, "uncond");
      const finallyEnd = buildStatements(
        builder,
        (statement.finalizer as { body: ReadonlyArray<EsTreeNode> }).body,
        finallyBlock,
      );
      addEdge(finallyEnd, merge, "uncond");
    } else {
      addEdge(tryEnd, merge, "uncond");
    }
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

interface FunctionCfgEntry {
  cfg: FunctionCfg;
  unconditionalSet: Set<BasicBlock>;
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

  return {
    cfgFor,
    enclosingFunction,
    isUnconditionalFromEntry,
  };
};
