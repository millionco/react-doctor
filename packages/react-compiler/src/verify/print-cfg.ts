/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Render an `HIRFunction`'s control flow as a structured, source-anchored
 * outline rather than a raw block graph. The shape mirrors how the code
 * actually behaves — unconditional runs, branches with their `then`/`else`,
 * loops, switches, early returns, and nested callbacks — and every node is
 * tagged with its source lines (and, when source is supplied, the line text).
 * The goal is that reading the source together with this outline is enough to
 * understand the component's behavior, without resolving block ids.
 */

import {
  type BasicBlock,
  type BlockId,
  type HIRFunction,
  type Instruction,
  type InstructionValue,
  type Place,
  type SourceLocation,
  type Terminal,
} from '../HIR';
import {buildDefinitions, displayName, printLoc} from './hir-access';

const MAX_SOURCE_TEXT_LENGTH = 100;

type Definitions = ReturnType<typeof buildDefinitions>;

const nestedFunction = (value: InstructionValue): HIRFunction | null => {
  if (value.kind === 'FunctionExpression' || value.kind === 'ObjectMethod') {
    return value.loweredFunc.func;
  }
  return null;
};

const describeNested = (value: InstructionValue): string => {
  if (value.kind === 'ObjectMethod') {
    return 'object method';
  }
  if (value.kind === 'FunctionExpression') {
    const kind = value.type === 'ArrowFunctionExpression' ? 'arrow fn' : 'function';
    const name = value.name ?? value.nameHint;
    return name != null ? `${kind} ${name}` : kind;
  }
  return 'function';
};

/** A condition is worth naming only when it resolves to a named binding (e.g.
 *  `show`); a temporary like `t95` is noise, so we fall back to the source. */
const conditionName = (test: Place, definitions: Definitions): string | null => {
  const name = displayName(test.identifier.id, definitions);
  return /^t\d+$/.test(name) ? null : name;
};

const lineOf = (loc: SourceLocation): number | null => printLoc(loc)?.line ?? null;

const lineSpan = (block: BasicBlock): {start: number; end: number} | null => {
  const lines: Array<number> = [];
  for (const instruction of block.instructions) {
    const line = lineOf(instruction.loc);
    if (line !== null) {
      lines.push(line);
    }
  }
  const terminalLine = lineOf(block.terminal.loc);
  if (terminalLine !== null) {
    lines.push(terminalLine);
  }
  if (lines.length === 0) {
    return null;
  }
  return {start: Math.min(...lines), end: Math.max(...lines)};
};

/** The single successor of a "pass-through" terminal (no real branching), or
 *  null for terminals that fork, exit, or otherwise need explicit structure. */
const passThroughSuccessor = (terminal: Terminal): BlockId | null => {
  switch (terminal.kind) {
    case 'goto':
    case 'label':
    case 'sequence':
    case 'scope':
    case 'pruned-scope':
      return terminal.block;
    case 'optional':
    case 'ternary':
    case 'logical':
      return terminal.test;
    case 'maybe-throw':
      return terminal.continuation;
    default:
      return null;
  }
};

const loopBody = (terminal: Terminal): BlockId | null =>
  'loop' in terminal ? terminal.loop : null;

interface Emitter {
  fn: HIRFunction;
  definitions: Definitions;
  sourceLines: Array<string> | null;
  visited: Set<BlockId>;
  out: Array<string>;
}

const tag = (emitter: Emitter, loc: SourceLocation): string => {
  const line = lineOf(loc);
  if (line === null) {
    return '';
  }
  const text = emitter.sourceLines?.[line - 1]?.trim() ?? '';
  if (text.length === 0) {
    return `  L${line}`;
  }
  const clipped =
    text.length > MAX_SOURCE_TEXT_LENGTH
      ? `${text.slice(0, MAX_SOURCE_TEXT_LENGTH)}…`
      : text;
  return `  L${line}  «${clipped}»`;
};

const emitNested = (emitter: Emitter, instruction: Instruction, indent: string): void => {
  const fn = nestedFunction(instruction.value);
  if (fn === null) {
    return;
  }
  emitter.out.push(
    `${indent}↳ ${describeNested(instruction.value)}${tag(emitter, instruction.loc)}`,
  );
  emitRegion(
    {
      fn,
      definitions: buildDefinitions(fn),
      sourceLines: emitter.sourceLines,
      visited: new Set(),
      out: emitter.out,
    },
    fn.body.entry,
    null,
    `${indent}  `,
  );
};

const flushRun = (
  emitter: Emitter,
  runLines: Array<number>,
  runInstructions: Array<Instruction>,
  indent: string,
): void => {
  if (runLines.length > 0) {
    const start = Math.min(...runLines);
    const end = Math.max(...runLines);
    const range = start === end ? `L${start}` : `L${start}-${end}`;
    emitter.out.push(`${indent}run ${range}`);
  }
  for (const instruction of runInstructions) {
    emitNested(emitter, instruction, `${indent}  `);
  }
};

function emitRegion(
  emitter: Emitter,
  start: BlockId,
  stop: BlockId | null,
  indent: string,
): void {
  let current: BlockId | null = start;
  let runLines: Array<number> = [];
  let runInstructions: Array<Instruction> = [];

  const flush = (): void => {
    flushRun(emitter, runLines, runInstructions, indent);
    runLines = [];
    runInstructions = [];
  };

  while (current !== null && current !== stop) {
    if (emitter.visited.has(current)) {
      flush();
      emitter.out.push(`${indent}↺ repeats earlier block`);
      return;
    }
    emitter.visited.add(current);

    const block = emitter.fn.body.blocks.get(current);
    if (block === undefined) {
      break;
    }

    for (const instruction of block.instructions) {
      const line = lineOf(instruction.loc);
      if (line !== null) {
        runLines.push(line);
      }
      if (nestedFunction(instruction.value) !== null) {
        runInstructions.push(instruction);
      }
    }

    const terminal = block.terminal;
    const next = passThroughSuccessor(terminal);
    if (next !== null) {
      current = next;
      continue;
    }

    const terminalLine = lineOf(terminal.loc);
    if (terminalLine !== null) {
      runLines.push(terminalLine);
    }

    switch (terminal.kind) {
      case 'if':
      case 'branch': {
        flush();
        const condition = conditionName(terminal.test, emitter.definitions);
        const label = condition !== null ? `if (${condition})` : 'if';
        emitter.out.push(`${indent}${label}${tag(emitter, terminal.loc)}`);
        emitter.out.push(`${indent}  then:`);
        emitRegion(emitter, terminal.consequent, terminal.fallthrough, `${indent}    `);
        if (terminal.alternate !== terminal.fallthrough) {
          emitter.out.push(`${indent}  else:`);
          emitRegion(emitter, terminal.alternate, terminal.fallthrough, `${indent}    `);
        }
        current = terminal.fallthrough;
        break;
      }
      case 'switch': {
        flush();
        const condition = conditionName(terminal.test, emitter.definitions);
        const label = condition !== null ? `switch (${condition})` : 'switch';
        emitter.out.push(`${indent}${label}${tag(emitter, terminal.loc)}`);
        for (const case_ of terminal.cases) {
          emitter.out.push(`${indent}  ${case_.test === null ? 'default:' : 'case:'}`);
          emitRegion(emitter, case_.block, terminal.fallthrough, `${indent}    `);
        }
        current = terminal.fallthrough;
        break;
      }
      case 'while':
      case 'do-while':
      case 'for':
      case 'for-of':
      case 'for-in': {
        flush();
        emitter.out.push(`${indent}loop ${terminal.kind}${tag(emitter, terminal.loc)}`);
        const body = loopBody(terminal);
        if (body !== null) {
          emitRegion(emitter, body, terminal.fallthrough, `${indent}  `);
        }
        current = terminal.fallthrough;
        break;
      }
      case 'try': {
        flush();
        emitter.out.push(`${indent}try${tag(emitter, terminal.loc)}`);
        emitRegion(emitter, terminal.block, terminal.fallthrough, `${indent}  `);
        emitter.out.push(`${indent}  catch:`);
        emitRegion(emitter, terminal.handler, terminal.fallthrough, `${indent}    `);
        current = terminal.fallthrough;
        break;
      }
      case 'return': {
        flush();
        emitter.out.push(`${indent}return${tag(emitter, terminal.loc)}`);
        current = null;
        break;
      }
      case 'throw': {
        flush();
        emitter.out.push(`${indent}throw${tag(emitter, terminal.loc)}`);
        current = null;
        break;
      }
      default: {
        flush();
        emitter.out.push(`${indent}${terminal.kind}${tag(emitter, terminal.loc)}`);
        current = null;
      }
    }
  }

  flush();
}

export function printControlFlow(
  fn: HIRFunction,
  sourceCode: string = '',
  indent: string = '',
): string {
  const out: Array<string> = [];
  emitRegion(
    {
      fn,
      definitions: buildDefinitions(fn),
      sourceLines: sourceCode.length > 0 ? sourceCode.split('\n') : null,
      visited: new Set(),
      out,
    },
    fn.body.entry,
    null,
    indent,
  );
  return out.join('\n');
}
