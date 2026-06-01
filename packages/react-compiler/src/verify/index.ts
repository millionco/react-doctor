/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * A soundness-tiered correctness verifier for React, built on the React
 * Compiler's HIR. Each `Check` proves the absence of a failure class
 * (`safe`), produces a counterexample (`violation`), or reports an explicit
 * open goal (`unknown`).
 */

export {verifySource, type VerifyOptions} from './verify-source';
export {
  extractHIR,
  forEachAnalyzedFunction,
  DEFAULT_STAGE,
  type ExtractHIROptions,
  type ExtractedFunction,
} from './capture-hir';
export {printControlFlow} from './print-cfg';
export {runChecks, type Check} from './run';
export {
  aggregateVerdict,
  type Finding,
  type Tier,
  type Verdict,
  type VerifierReport,
} from './verdict';
export {noConditionalHook} from './checks/conditional-hook';
export {noEffectInfiniteLoop} from './checks/effect-infinite-loop';
export {effectMissingCleanup} from './checks/effect-missing-cleanup';
export {noRefReadInRender} from './checks/ref-access-in-render';
export {noResourceInRender} from './checks/resource-in-render';
export {noSetStateInRender} from './checks/set-state-in-render';
export {noUnstableJsxProp} from './checks/unstable-jsx-prop';
