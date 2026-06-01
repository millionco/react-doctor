/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Source-level entry point for the verifier. Compiles the input with the React
 * Compiler frontend and runs the verifier checks against the analyzed HIR,
 * captured at the `InferReactivePlaces` stage (reactivity + aliasing inferred,
 * before reactive scopes / memoization — i.e. the program "as written").
 */

import {forEachAnalyzedFunction} from './capture-hir';
import {noConditionalHook} from './checks/conditional-hook';
import {noEffectInfiniteLoop} from './checks/effect-infinite-loop';
import {effectMissingCleanup} from './checks/effect-missing-cleanup';
import {noRefReadInRender} from './checks/ref-access-in-render';
import {noResourceInRender} from './checks/resource-in-render';
import {noSetStateInRender} from './checks/set-state-in-render';
import {noUnstableJsxProp} from './checks/unstable-jsx-prop';
import {runChecks, type Check} from './run';
import {aggregateVerdict, type Finding, type VerifierReport} from './verdict';

const CHECKS: ReadonlyArray<Check> = [
  // Termination / convergence
  noEffectInfiniteLoop,
  noSetStateInRender,
  // Rules of Hooks
  noConditionalHook,
  // Render purity
  noRefReadInRender,
  // Effect correctness
  effectMissingCleanup,
  // Cross-component cascade
  noUnstableJsxProp,
  // Resource lifecycle
  noResourceInRender,
];

export interface VerifyOptions {
  filename?: string;
}

export function verifySource(
  code: string,
  options: VerifyOptions = {},
): VerifierReport {
  const filename = options.filename ?? 'Component.tsx';
  const findings: Array<Finding> = [];
  let analyzedFunctions = 0;

  forEachAnalyzedFunction(code, filename, (fn) => {
    analyzedFunctions++;
    findings.push(...runChecks(fn, CHECKS));
  });

  return {
    verdict: aggregateVerdict(findings),
    analyzedFunctions,
    findings,
  };
}
