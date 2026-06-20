import type { BasicBlock, FunctionCfg } from "./ir/basic-block.js";
import type { Phi, SsaIdentifier } from "./ir/place.js";
import type { Terminal } from "./ir/terminal.js";

const ssaName = (identifier: SsaIdentifier): string => `${identifier.name}#${identifier.version}`;

const phiLabel = (phi: Phi): string => {
  const operands = [...phi.operands]
    .map(([predecessor, value]) => `b${predecessor.id}:${ssaName(value)}`)
    .join(", ");
  return `${ssaName(phi.identifier)} = φ(${operands})`;
};

const escapeDotLabel = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\l");

const terminalLabel = (terminal: Terminal): string => {
  switch (terminal.kind) {
    case "goto":
      return `goto b${terminal.block.id} (${terminal.variant})`;
    case "if":
      return `if → b${terminal.consequent.id} / b${terminal.alternate.id}`;
    case "switch":
      return `switch (${terminal.cases.length} cases)`;
    case "while":
    case "do-while":
      return `${terminal.kind} → b${terminal.body.id}`;
    case "for":
    case "for-in":
    case "for-of":
      return `${terminal.kind} → b${terminal.body.id}`;
    case "logical":
    case "ternary":
    case "optional":
      return `${terminal.kind} ↦ b${terminal.fallthrough.id}`;
    case "try":
      return `try → b${terminal.block.id}`;
    case "return":
      return "return";
    case "throw":
      return "throw";
    case "unreachable":
      return "unreachable";
  }
};

const blockLabel = (block: BasicBlock): string => {
  const lines = [`#${block.id}`];
  for (const phi of block.phis) {
    lines.push(phiLabel(phi));
  }
  for (const instruction of block.instructions) {
    lines.push(`${instruction.kind}: ${instruction.node.type}`);
  }
  lines.push(`» ${terminalLabel(block.terminal)}`);
  return lines.join("\n");
};

// Graphviz DOT rendering of a function CFG — mirroring oxc_cfg's
// `DisplayDot`. Blocks become boxes listing their typed instructions and
// terminal; edges are labeled with their kind. Deterministic (creation
// order) so it is snapshot-stable. Debugging aid; no rule consumes it.
export const cfgToDot = (cfg: FunctionCfg): string => {
  const lines: string[] = ['digraph "cfg" {'];
  lines.push("  node [shape=box fontname=monospace];");
  for (const block of cfg.blocks) {
    lines.push(`  b${block.id} [label="${escapeDotLabel(blockLabel(block))}\\l"];`);
  }
  for (const block of cfg.blocks) {
    for (const edge of block.successors) {
      lines.push(`  b${edge.from.id} -> b${edge.to.id} [label="${edge.kind}"];`);
    }
  }
  lines.push("}");
  return lines.join("\n");
};
