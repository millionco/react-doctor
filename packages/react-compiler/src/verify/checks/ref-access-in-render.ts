/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Family: Render purity. Proves the render body does not read a ref's
 * `.current`. The component body executes during render, so reading a mutable
 * ref there makes the output depend on state React doesn't track for rendering
 * — unsafe under concurrent/streaming render and a purity violation.
 *
 * (Reads inside effects / event handlers are fine: those are separate lowered
 * functions and are not scanned here.)
 */

import {
  type HIRFunction,
  isRefValueType,
  isUseRefType,
} from '../../HIR';
import {printLoc} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'no-ref-read-in-render';

function run(fn: HIRFunction): Array<Finding> {
  const findings: Array<Finding> = [];
  const componentName = fn.id ?? null;

  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind !== 'PropertyLoad' || value.property !== 'current') {
        continue;
      }
      if (
        !isUseRefType(value.object.identifier) &&
        !isRefValueType(value.object.identifier)
      ) {
        continue;
      }
      findings.push({
        property: PROPERTY,
        verdict: 'violation',
        tier: 'proven',
        functionName: componentName,
        reason:
          'A ref `.current` value is read during render; render output must not depend on a mutable ref that React does not track for rendering.',
        witness: [
          'render reads `ref.current`',
          '  → the rendered output depends on a value React does not track',
          '∴ unsafe under concurrent rendering (tearing / stale reads)',
        ],
        loc: printLoc(value.loc),
      });
    }
  }
  return findings;
}

export const noRefReadInRender: Check = {property: PROPERTY, run};
