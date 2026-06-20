import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import type { Lattice } from "../dataflow/lattice.js";
import { solveDataflow } from "../dataflow/solve.js";
import type { ResolveValueAtom } from "../path/path-condition.js";
import type { TypestateAutomaton } from "./automaton.js";
import { createTypestateFeasibilityRefiner } from "./feasibility-refiner.js";

// One protocol event observed at a concrete AST node: resource `resource`
// (an opaque identity the classifier mints — e.g. a variable name or a
// call-site key) sees `event` at `node`.
export interface ResourceEvent {
  readonly resource: string;
  readonly event: string;
  readonly node: EsTreeNode;
}

// Maps a block instruction's AST node to the protocol events its execution
// produces, in evaluation order (empty for irrelevant instructions). The
// rule walks the subtree; the engine stays protocol-agnostic.
export interface TypestateClassifier {
  (instructionNode: EsTreeNode): ReadonlyArray<ResourceEvent>;
}

export interface TypestateViolation {
  // `error-transition`: an illegal event drove the resource into an error
  // state (reported at the offending event node).
  // `leaked-resource`: the resource can rest in a non-accepting state at
  // normal completion (reported at its open site).
  readonly kind: "error-transition" | "leaked-resource";
  readonly resource: string;
  readonly node: EsTreeNode;
  readonly state: string;
}

export interface VerifyTypestateOptions {
  readonly automaton: TypestateAutomaton;
  readonly classifier: TypestateClassifier;
  // Layer D refinement (opt-in): when supplied, a leak is reported only if at
  // least one of its leaking paths is not provably infeasible. Maps a test
  // identifier to its abstract atom (keyed by `ssa.versionAt` so correlated
  // open/close guards collapse to one atom).
  readonly resolveValue?: ResolveValueAtom;
}

// The set of states each resource may be in. A total map over every
// resource the program mentions: an empty set means "no fact yet"
// (unreachable), so it is the join (union) identity, while the entry
// boundary seeds every resource to {initial}.
type StateFact = ReadonlyMap<string, ReadonlySet<string>>;

const unionInto = (target: Set<string>, source: ReadonlySet<string>): void => {
  for (const value of source) target.add(value);
};

const setsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

export type EventsByBlock = ReadonlyMap<BasicBlock, ReadonlyArray<ResourceEvent>>;

const nodeStart = (node: EsTreeNode): number => node.range?.[0] ?? 0;

// Every protocol event, attributed to the block it actually executes in via
// `cfg.blockOf` and deduplicated by node. A single call node can surface
// under more than one instruction's subtree — most importantly the
// `implicit-return` instruction's node spans the whole body — so without
// canonical attribution a call would be (mis)counted in a later block whose
// state has already advanced. Events are ordered by source position, which
// matches evaluation order for the straight-line code inside one block.
const collectEventsByBlock = (cfg: FunctionCfg, options: VerifyTypestateOptions): EventsByBlock => {
  const seen = new Set<EsTreeNode>();
  const byBlock = new Map<BasicBlock, ResourceEvent[]>();
  for (const block of cfg.blocks) {
    for (const instruction of block.instructions) {
      for (const resourceEvent of options.classifier(instruction.node)) {
        if (seen.has(resourceEvent.node)) continue;
        seen.add(resourceEvent.node);
        const canonical = cfg.blockOf(resourceEvent.node) ?? block;
        const list = byBlock.get(canonical);
        if (list) list.push(resourceEvent);
        else byBlock.set(canonical, [resourceEvent]);
      }
    }
  }
  for (const list of byBlock.values()) {
    list.sort((left, right) => nodeStart(left.node) - nodeStart(right.node));
  }
  return byBlock;
};

// Run a block's events over the incoming per-resource state sets, returning
// the outgoing sets. `onErrorTransition` (detection pass only) fires when an
// event drives a resource from a legal state into an error state.
const stepBlock = (
  block: BasicBlock,
  incoming: StateFact,
  eventsByBlock: EventsByBlock,
  automaton: TypestateAutomaton,
  onErrorTransition?: (event: ResourceEvent, state: string) => void,
): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const [resource, states] of incoming) out.set(resource, new Set(states));

  for (const resourceEvent of eventsByBlock.get(block) ?? []) {
    const states = out.get(resourceEvent.resource);
    if (!states || states.size === 0) continue;
    const next = new Set<string>();
    for (const state of states) {
      const target = automaton.transition(state, resourceEvent.event);
      next.add(target);
      if (
        onErrorTransition &&
        automaton.errorStates.has(target) &&
        !automaton.errorStates.has(state)
      ) {
        onErrorTransition(resourceEvent, target);
      }
    }
    out.set(resourceEvent.resource, next);
  }
  return out;
};

// The first node (in source order) at which each resource is mentioned — its
// open site, where a leak is reported.
const collectOpenSites = (
  cfg: FunctionCfg,
  eventsByBlock: EventsByBlock,
): Map<string, EsTreeNode> => {
  const openSites = new Map<string, EsTreeNode>();
  for (const block of cfg.blocks) {
    for (const resourceEvent of eventsByBlock.get(block) ?? []) {
      const existing = openSites.get(resourceEvent.resource);
      if (!existing || nodeStart(resourceEvent.node) < nodeStart(existing)) {
        openSites.set(resourceEvent.resource, resourceEvent.node);
      }
    }
  }
  return openSites;
};

// Verify a typestate protocol over a function's CFG. Built on the generic
// `solveDataflow` worklist: the fact is each resource's set of possible
// states, joined by union at merges. After the fixpoint, a deterministic
// pass reports error transitions, and the normal-completion exit fact
// (predecessors minus `throw` edges) reports leaks. The reusable
// generalization of the hand-rolled effect-cleanup leak check.
export const verifyTypestate = (
  cfg: FunctionCfg,
  options: VerifyTypestateOptions,
): TypestateViolation[] => {
  const eventsByBlock = collectEventsByBlock(cfg, options);
  const openSites = collectOpenSites(cfg, eventsByBlock);
  const resources = [...openSites.keys()];
  if (resources.length === 0) return [];

  const initialState = options.automaton.initial;
  const lattice: Lattice<StateFact> = {
    bottom: new Map(resources.map((resource) => [resource, new Set<string>()])),
    join: (left, right) => {
      const merged = new Map<string, Set<string>>();
      for (const resource of resources) {
        const states = new Set<string>();
        unionInto(states, left.get(resource) ?? new Set());
        unionInto(states, right.get(resource) ?? new Set());
        merged.set(resource, states);
      }
      return merged;
    },
    equals: (left, right) =>
      resources.every((resource) =>
        setsEqual(left.get(resource) ?? new Set(), right.get(resource) ?? new Set()),
      ),
  };

  const result = solveDataflow<StateFact>({
    cfg,
    lattice,
    direction: "forward",
    boundary: new Map(resources.map((resource) => [resource, new Set([initialState])])),
    transfer: (block, incoming) => stepBlock(block, incoming, eventsByBlock, options.automaton),
  });

  const violations: TypestateViolation[] = [];

  // Layer D: refines both detection passes by suppressing a violation only
  // when every path that would witness it is provably infeasible. A no-op
  // unless `resolveValue` is supplied; memoizes its path enumeration so the
  // refinement is computed at most once per block, not once per diagnostic.
  const refiner = createTypestateFeasibilityRefiner({
    cfg,
    automaton: options.automaton,
    eventsByBlock,
    initialState,
    resolveValue: options.resolveValue,
  });

  // Error transitions: replay each reachable block from its stable entry
  // fact, reporting at most once per offending node.
  const reportedErrorNodes = new Set<EsTreeNode>();
  for (const block of cfg.blocks) {
    stepBlock(
      block,
      result.entryFactOf(block),
      eventsByBlock,
      options.automaton,
      (resourceEvent, state) => {
        if (reportedErrorNodes.has(resourceEvent.node)) return;
        reportedErrorNodes.add(resourceEvent.node);
        if (refiner.errorProvablyInfeasible(resourceEvent)) return;
        violations.push({
          kind: "error-transition",
          resource: resourceEvent.resource,
          node: resourceEvent.node,
          state,
        });
      },
    );
  }

  // Leaks: a resource resting in a non-accepting (non-error) state on a
  // normal-completion path — the exit joined over its non-`throw`
  // predecessors.
  let normalExit: StateFact = lattice.bottom;
  for (const edge of cfg.exit.predecessors) {
    if (edge.kind === "throw") continue;
    normalExit = lattice.join(normalExit, result.exitFactOf(edge.from));
  }
  for (const resource of resources) {
    for (const state of normalExit.get(resource) ?? new Set<string>()) {
      if (options.automaton.acceptingStates.has(state)) continue;
      if (options.automaton.errorStates.has(state)) continue;
      if (refiner.leakProvablyInfeasible(resource, openSites.get(resource))) break;
      violations.push({
        kind: "leaked-resource",
        resource,
        node: openSites.get(resource)!,
        state,
      });
      break;
    }
  }

  return violations;
};
