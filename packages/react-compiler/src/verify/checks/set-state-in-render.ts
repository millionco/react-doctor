/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Proves the "setState during render" infinite loop. A setState call in the
 * component body (not inside an effect or event handler — those are separate
 * lowered functions) schedules a render synchronously; if it runs
 * unconditionally, React re-renders forever ("Too many re-renders").
 *
 * Soundness: an unconditional render-phase setState is a `violation`; a
 * conditional one is `unknown` (the guard may converge — e.g. the supported
 * "adjust state during render" escape hatch).
 */

import {type HIRFunction, isSetStateType} from '../../HIR';
import {identifierName, printLoc, unconditionalBlocks} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'no-set-state-in-render';

function run(fn: HIRFunction): Array<Finding> {
  const findings: Array<Finding> = [];
  const unconditional = unconditionalBlocks(fn);
  const componentName = fn.id ?? null;

  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind !== 'CallExpression') {
        continue;
      }
      if (!isSetStateType(value.callee.identifier)) {
        continue;
      }
      const isUnconditional = unconditional.has(block.id);
      const setterName = identifierName(value.callee.identifier);
      findings.push({
        property: PROPERTY,
        verdict: isUnconditional ? 'violation' : 'unknown',
        tier: 'proven',
        functionName: componentName,
        reason: isUnconditional
          ? 'setState is called unconditionally during render, scheduling a render synchronously — an unbounded loop.'
          : 'setState is called during render behind a condition; whether it loops depends on the guard converging.',
        witness: isUnconditional
          ? [
              'render runs',
              `  → \`${setterName}(…)\` is called during render`,
              '  → schedules a re-render → render runs → …',
              '∴ unbounded re-render',
            ]
          : [],
        loc: printLoc(value.loc),
      });
    }
  }
  return findings;
}

export const noSetStateInRender: Check = {property: PROPERTY, run};
