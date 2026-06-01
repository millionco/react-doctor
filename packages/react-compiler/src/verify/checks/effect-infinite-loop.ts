/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Proves (or rules out) the classic effect-driven infinite render loop:
 *
 *   const config = {…};                  // fresh reference every render
 *   useEffect(() => { setData(…); }, [config]);
 *
 * The effect's dependency changes identity on every render (Unstable), so the
 * effect re-runs after every render; the effect unconditionally calls setState,
 * which schedules the next render — an unbounded loop.
 *
 * Soundness:
 *   - `violation` is only reported when BOTH the re-run trigger AND the setState
 *     write are *must* facts (the effect is set up unconditionally, the dep is
 *     provably fresh or absent, and the setState is on the effect's
 *     unconditional path). A witness trace is attached.
 *   - When a dependency can't be classified, or the setState is guarded by a
 *     condition whose convergence we can't prove, we return `unknown` rather
 *     than guess. Props are treated as stable at the component boundary.
 */

import {
  type HIRFunction,
  type IdentifierId,
  type Instruction,
  type Place,
  isSetStateType,
  isUseEffectHookType,
  isUseLayoutEffectHookType,
} from '../../HIR';
import {
  buildDefinitions,
  displayName,
  isFreshAllocation,
  printLoc,
  unconditionalBlocks,
  underlyingValue,
} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'no-effect-infinite-loop';

type Trigger =
  | {kind: 'no-deps'}
  | {kind: 'unstable-dep'; name: string}
  | {kind: 'stable'}
  | {kind: 'unknown'};

interface SetStateWrite {
  /** A setState call proven to run on every effect invocation. */
  unconditional: Place | null;
  /** Any setState call in the effect, conditional or not. */
  any: Place | null;
  /** Human-readable name of the setter, for the witness. */
  name: string;
}

function classifyDeps(
  depsArrayId: IdentifierId,
  definitions: Map<IdentifierId, Instruction>,
): Trigger {
  const depsValue = underlyingValue(depsArrayId, definitions);
  if (depsValue === null || depsValue.kind !== 'ArrayExpression') {
    return {kind: 'unknown'};
  }
  let sawUnknown = false;
  for (const element of depsValue.elements) {
    if (element.kind !== 'Identifier') {
      // a spread or hole — can't reason precisely about the dependency set
      sawUnknown = true;
      continue;
    }
    const value = underlyingValue(element.identifier.id, definitions);
    if (isFreshAllocation(value)) {
      return {
        kind: 'unstable-dep',
        name: displayName(element.identifier.id, definitions),
      };
    }
    if (value === null) {
      // defined outside this function (param/prop/capture): stable at the
      // component boundary, so not an Unknown that should block a verdict.
      continue;
    }
  }
  return sawUnknown ? {kind: 'unknown'} : {kind: 'stable'};
}

function findSetStateWrite(effectFn: HIRFunction): SetStateWrite {
  const unconditional = unconditionalBlocks(effectFn);
  const definitions = buildDefinitions(effectFn);
  const aliases = new Set<IdentifierId>();
  for (const place of effectFn.context) {
    if (isSetStateType(place.identifier)) {
      aliases.add(place.identifier.id);
    }
  }

  let unconditionalCall: Place | null = null;
  let anyCall: Place | null = null;
  let name = 'setState';
  for (const [, block] of effectFn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind === 'LoadLocal') {
        if (
          isSetStateType(value.place.identifier) ||
          aliases.has(value.place.identifier.id)
        ) {
          aliases.add(instr.lvalue.identifier.id);
        }
      } else if (value.kind === 'StoreLocal') {
        if (
          isSetStateType(value.value.identifier) ||
          aliases.has(value.value.identifier.id)
        ) {
          aliases.add(value.lvalue.place.identifier.id);
          aliases.add(instr.lvalue.identifier.id);
        }
      } else if (value.kind === 'CallExpression') {
        const callee = value.callee;
        if (isSetStateType(callee.identifier) || aliases.has(callee.identifier.id)) {
          anyCall ??= callee;
          if (unconditional.has(block.id) && unconditionalCall === null) {
            unconditionalCall = callee;
            name = displayName(callee.identifier.id, definitions);
          }
        }
      }
    }
  }
  return {unconditional: unconditionalCall, any: anyCall, name};
}

function buildWitness(
  trigger: {kind: 'no-deps'} | {kind: 'unstable-dep'; name: string},
  setterName: string,
  componentName: string | null,
): Array<string> {
  const where = componentName !== null ? ` in ${componentName}` : '';
  const lines: Array<string> = [`render N${where}:`];
  if (trigger.kind === 'no-deps') {
    lines.push('  effect has no dependency array → runs after every render');
  } else if (trigger.kind === 'unstable-dep') {
    lines.push(
      `  dependency \`${trigger.name}\` is freshly allocated each render → Unstable`,
      '  → the dependency array differs on every render',
    );
  }
  lines.push(
    `  effect runs and unconditionally calls \`${setterName}(…)\` → schedules a re-render`,
    'render N+1:',
    trigger.kind === 'no-deps'
      ? '  effect runs again (no deps) → setState → …'
      : `  \`${trigger.name}\` is re-allocated → deps differ → effect runs again → setState → …`,
    '∴ unbounded re-render',
  );
  return lines;
}

function unknownFinding(
  componentName: string | null,
  loc: Finding['loc'],
  reason: string,
): Finding {
  return {
    property: PROPERTY,
    verdict: 'unknown',
    tier: 'proven',
    functionName: componentName,
    reason,
    witness: [],
    loc,
  };
}

function run(fn: HIRFunction): Array<Finding> {
  const findings: Array<Finding> = [];
  const definitions = buildDefinitions(fn);
  const componentUnconditional = unconditionalBlocks(fn);
  const componentName = fn.id ?? null;

  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind !== 'CallExpression') {
        continue;
      }
      const callee = value.callee;
      if (
        !isUseEffectHookType(callee.identifier) &&
        !isUseLayoutEffectHookType(callee.identifier)
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

      const depsArg = value.args[1];
      const trigger: Trigger =
        depsArg === undefined
          ? {kind: 'no-deps'}
          : depsArg.kind === 'Identifier'
            ? classifyDeps(depsArg.identifier.id, definitions)
            : {kind: 'unknown'};

      const write = findSetStateWrite(effectFn);
      const loc = printLoc(value.loc);
      const reRuns = trigger.kind === 'no-deps' || trigger.kind === 'unstable-dep';

      if (
        write.unconditional !== null &&
        (trigger.kind === 'no-deps' || trigger.kind === 'unstable-dep')
      ) {
        if (componentUnconditional.has(block.id)) {
          findings.push({
            property: PROPERTY,
            verdict: 'violation',
            tier: 'proven',
            functionName: componentName,
            reason:
              'Effect re-runs on every render and unconditionally calls setState, causing an unbounded render loop.',
            witness: buildWitness(trigger, write.name, componentName),
            loc,
          });
        } else {
          findings.push(
            unknownFinding(
              componentName,
              loc,
              'The effect is set up inside a conditional, so the loop cannot be proven to always occur.',
            ),
          );
        }
      } else if (write.unconditional !== null && trigger.kind === 'unknown') {
        findings.push(
          unknownFinding(
            componentName,
            loc,
            'A dependency could not be classified as stable or unstable, so re-runs cannot be ruled out.',
          ),
        );
      } else if (write.unconditional === null && write.any !== null && reRuns) {
        findings.push(
          unknownFinding(
            componentName,
            loc,
            'The effect calls setState behind a condition; convergence of that guard cannot be proven.',
          ),
        );
      }
      // Otherwise: stable deps or no setState → safe with respect to this effect.
    }
  }
  return findings;
}

export const noEffectInfiniteLoop: Check = {property: PROPERTY, run};
