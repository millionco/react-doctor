/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Family: Resource lifecycle. Proves that no timer / animation frame is started
 * directly in the render body. Render runs on every update, so a timer created
 * there is re-created (and orphaned) every render — a guaranteed leak and a
 * render side effect.
 *
 * Soundness: a timer global called in the component body (render phase) is a
 * `violation`. Timers belong in effects, which have cleanup.
 */

import {type HIRFunction} from '../../HIR';
import {buildDefinitions, globalName, printLoc} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'no-resource-in-render';

const RESOURCE_GLOBALS: ReadonlySet<string> = new Set([
  'setInterval',
  'setTimeout',
  'requestAnimationFrame',
  'setImmediate',
]);

function run(fn: HIRFunction): Array<Finding> {
  const findings: Array<Finding> = [];
  const definitions = buildDefinitions(fn);
  const componentName = fn.id ?? null;

  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind !== 'CallExpression') {
        continue;
      }
      const name = globalName(value.callee.identifier.id, definitions);
      if (name === null || !RESOURCE_GLOBALS.has(name)) {
        continue;
      }
      findings.push({
        property: PROPERTY,
        verdict: 'violation',
        tier: 'proven',
        functionName: componentName,
        reason:
          'A timer is started directly during render; render runs on every update, so the timer is re-created and orphaned each time.',
        witness: [
          `\`${name}(…)\` is called during render`,
          '  → a new timer/callback is scheduled on every render and never cleared',
          '∴ resource leak (move it into a useEffect with cleanup)',
        ],
        loc: printLoc(value.loc),
      });
    }
  }
  return findings;
}

export const noResourceInRender: Check = {property: PROPERTY, run};
