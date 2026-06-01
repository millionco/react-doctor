/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Family: Rules of Hooks. Proves that every hook call in a component/hook runs
 * unconditionally. A hook reached only on some renders shifts the hook index on
 * the renders where the guard flips, which React relies on being invariant.
 *
 * Soundness: a hook call outside the unconditional (must-execute) block set is
 * a `violation` — its execution is not guaranteed on every render.
 */

import {type HIRFunction, type Identifier, getHookKind} from '../../HIR';
import {
  buildDefinitions,
  globalName,
  identifierName,
  printLoc,
  unconditionalBlocks,
} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'no-conditional-hook';

function run(fn: HIRFunction): Array<Finding> {
  const findings: Array<Finding> = [];
  const unconditional = unconditionalBlocks(fn);
  const definitions = buildDefinitions(fn);
  const componentName = fn.id ?? null;

  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      let callee: Identifier | null = null;
      if (value.kind === 'CallExpression') {
        callee = value.callee.identifier;
      } else if (value.kind === 'MethodCall') {
        callee = value.property.identifier;
      }
      if (callee === null || getHookKind(fn.env, callee) === null) {
        continue;
      }
      if (unconditional.has(block.id)) {
        continue;
      }
      const hookName = globalName(callee.id, definitions) ?? identifierName(callee);
      findings.push({
        property: PROPERTY,
        verdict: 'violation',
        tier: 'proven',
        functionName: componentName,
        reason:
          'A hook is called conditionally (inside a branch or loop); the hook call order must be identical on every render.',
        witness: [
          `hook \`${hookName}\` is called inside a conditional / loop`,
          '  → on a render where the guard flips, the hook call order changes',
          '∴ Rules of Hooks violated (call order is not invariant)',
        ],
        loc: printLoc(instr.loc),
      });
    }
  }
  return findings;
}

export const noConditionalHook: Check = {property: PROPERTY, run};
