/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Family: Effect correctness. Flags an effect that acquires a long-lived
 * resource (event listener, subscription, interval) but returns no cleanup
 * function — a leak across re-mounts / dependency changes.
 *
 * Tier: structural. We can prove the resource is acquired and that no cleanup
 * function is returned, but whether a leak is harmful in context is a policy
 * call, so this is a strong smell rather than a guaranteed runtime failure.
 */

import {
  type HIRFunction,
  type IdentifierId,
  type Instruction,
  isUseEffectHookType,
  isUseLayoutEffectHookType,
} from '../../HIR';
import {buildDefinitions, globalName, printLoc, underlyingValue} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'effect-missing-cleanup';

const TIMER_GLOBALS: ReadonlySet<string> = new Set([
  'setInterval',
  'requestAnimationFrame',
]);

const LISTENER_METHODS: ReadonlySet<string> = new Set([
  'addEventListener',
  'subscribe',
  'addListener',
]);

function findResourceAcquisition(
  effectFn: HIRFunction,
  definitions: Map<IdentifierId, Instruction>,
): string | null {
  for (const [, block] of effectFn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind === 'CallExpression') {
        const name = globalName(value.callee.identifier.id, definitions);
        if (name !== null && TIMER_GLOBALS.has(name)) {
          return name;
        }
      } else if (
        value.kind === 'PropertyLoad' &&
        typeof value.property === 'string' &&
        LISTENER_METHODS.has(value.property)
      ) {
        return value.property;
      }
    }
  }
  return null;
}

function returnsCleanupFunction(
  effectFn: HIRFunction,
  definitions: Map<IdentifierId, Instruction>,
): boolean {
  for (const [, block] of effectFn.body.blocks) {
    if (block.terminal.kind !== 'return') {
      continue;
    }
    const returned = underlyingValue(block.terminal.value.identifier.id, definitions);
    if (returned !== null && returned.kind === 'FunctionExpression') {
      return true;
    }
  }
  return false;
}

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
      if (
        !isUseEffectHookType(value.callee.identifier) &&
        !isUseLayoutEffectHookType(value.callee.identifier)
      ) {
        continue;
      }
      const effectArg = value.args[0];
      if (effectArg === undefined || effectArg.kind !== 'Identifier') {
        continue;
      }
      const effectValue = underlyingValue(effectArg.identifier.id, definitions);
      if (effectValue === null || effectValue.kind !== 'FunctionExpression') {
        continue;
      }
      const effectFn = effectValue.loweredFunc.func;
      const effectDefinitions = buildDefinitions(effectFn);

      const resource = findResourceAcquisition(effectFn, effectDefinitions);
      if (resource === null) {
        continue;
      }
      if (returnsCleanupFunction(effectFn, effectDefinitions)) {
        continue;
      }
      findings.push({
        property: PROPERTY,
        verdict: 'violation',
        tier: 'structural',
        functionName: componentName,
        reason:
          'An effect acquires a long-lived resource (listener / subscription / interval) but returns no cleanup function.',
        witness: [
          `effect calls \`${resource}(…)\` to acquire a resource`,
          '  → the effect returns no cleanup function',
          '∴ the resource leaks across re-mounts and dependency changes',
        ],
        loc: printLoc(value.loc),
      });
    }
  }
  return findings;
}

export const effectMissingCleanup: Check = {property: PROPERTY, run};
