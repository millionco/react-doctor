/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Shared, pure helpers for reading the compiler's HIR during verification:
 * SSA definition lookup, alias resolution to underlying values, fresh-
 * allocation detection, and a conservative "executes on every render" block
 * set used as the must-analysis backbone.
 */

import type {
  BlockId,
  HIRFunction,
  Identifier,
  IdentifierId,
  Instruction,
  InstructionValue,
  SourceLocation,
} from '../HIR';

export interface PrintedLoc {
  line: number;
  column: number;
}

/**
 * Instruction value kinds that allocate a fresh reference every time they run.
 * Two evaluations are never `Object.is`-equal, so using one as an effect
 * dependency forces the effect to re-run on every render.
 */
const ALLOCATION_KINDS: ReadonlySet<string> = new Set([
  'ObjectExpression',
  'ArrayExpression',
  'FunctionExpression',
  'ObjectMethod',
  'NewExpression',
  'JsxExpression',
  'JsxFragment',
  'RegExpLiteral',
]);

export function identifierName(identifier: Identifier): string {
  return identifier.name?.value ?? `t${identifier.id}`;
}

export function printLoc(loc: SourceLocation): PrintedLoc | null {
  if (typeof loc === 'symbol') {
    return null;
  }
  return {line: loc.start.line, column: loc.start.column};
}

/**
 * Map every SSA identifier to the instruction that defines it. After SSA each
 * identifier has exactly one definition, so this is unambiguous.
 */
export function buildDefinitions(
  fn: HIRFunction,
): Map<IdentifierId, Instruction> {
  const definitions = new Map<IdentifierId, Instruction>();
  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      definitions.set(instr.lvalue.identifier.id, instr);
      // A `StoreLocal` binds a named variable via its *inner* lvalue (e.g.
      // `config` in `const config = {}`), which differs from the instruction's
      // own temporary lvalue. Index it so reads of the variable resolve.
      if (instr.value.kind === 'StoreLocal') {
        definitions.set(instr.value.lvalue.place.identifier.id, instr);
      }
    }
  }
  return definitions;
}

/**
 * Resolve an identifier through `LoadLocal` / `StoreLocal` chains to the value
 * that actually produced it (e.g. the `ObjectExpression` behind `const c = {}`).
 * Returns null if the value isn't defined in this function (params, captures).
 */
export function underlyingValue(
  identifierId: IdentifierId,
  definitions: Map<IdentifierId, Instruction>,
): InstructionValue | null {
  const seen = new Set<IdentifierId>();
  let current: IdentifierId | null = identifierId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const instr = definitions.get(current);
    if (instr === undefined) {
      return null;
    }
    const value = instr.value;
    if (value.kind === 'LoadLocal') {
      current = value.place.identifier.id;
    } else if (value.kind === 'StoreLocal') {
      current = value.value.identifier.id;
    } else {
      return value;
    }
  }
  return null;
}

export function isFreshAllocation(value: InstructionValue | null): boolean {
  return value !== null && ALLOCATION_KINDS.has(value.kind);
}

/**
 * If `identifierId` resolves to a `LoadGlobal` (an imported or global binding),
 * return the name it refers to (the imported name for import specifiers). Used
 * to recognize calls like `setInterval` or `addEventListener`.
 */
export function globalName(
  identifierId: IdentifierId,
  definitions: Map<IdentifierId, Instruction>,
): string | null {
  const value = underlyingValue(identifierId, definitions);
  if (value === null || value.kind !== 'LoadGlobal') {
    return null;
  }
  const binding = value.binding;
  return 'imported' in binding ? binding.imported : binding.name;
}

/**
 * Best human-readable name for the variable an identifier resolves to, walking
 * `LoadLocal` / `StoreLocal` chains to a named binding (e.g. the temporary in a
 * deps array resolves back to `config`). Falls back to the temporary's name.
 */
export function displayName(
  identifierId: IdentifierId,
  definitions: Map<IdentifierId, Instruction>,
): string {
  const seen = new Set<IdentifierId>();
  let current: IdentifierId | null = identifierId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const instr = definitions.get(current);
    if (instr === undefined) {
      break;
    }
    const value = instr.value;
    if (value.kind === 'StoreLocal') {
      if (value.lvalue.place.identifier.name != null) {
        return value.lvalue.place.identifier.name.value;
      }
      current = value.value.identifier.id;
    } else if (value.kind === 'LoadLocal') {
      if (value.place.identifier.name != null) {
        return value.place.identifier.name.value;
      }
      current = value.place.identifier.id;
    } else {
      break;
    }
  }
  return `t${identifierId}`;
}

/**
 * The set of blocks guaranteed to execute on every invocation of `fn`: the
 * entry block plus the straight-line `goto` chain leading from it. Conservative
 * by design — it stops at the first branching terminal, so anything inside a
 * conditional is excluded. This is the must-execute backbone: a fact proven
 * here holds on every render, which is what soundness for `violation` requires.
 */
export function unconditionalBlocks(fn: HIRFunction): Set<BlockId> {
  const result = new Set<BlockId>();
  let current: BlockId | null = fn.body.entry;
  while (current !== null && !result.has(current)) {
    result.add(current);
    const block = fn.body.blocks.get(current);
    if (block === undefined) {
      break;
    }
    current = block.terminal.kind === 'goto' ? block.terminal.block : null;
  }
  return result;
}
