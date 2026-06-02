/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Core verdict model for the React correctness verifier. A verifier has three
 * outcomes, not two:
 *
 *   - `safe`      proof of absence: the property provably holds (no finding)
 *   - `violation` proof of presence: a concrete counterexample / witness
 *   - `unknown`   no proof either way (the analyzer's open goal)
 *
 * Soundness contract: a `safe` aggregate means none of the checked properties
 * can be violated under the verifier's model; any loss of precision must
 * resolve to `unknown`, never to `safe`.
 */

import type {PrintedLoc} from './hir-access';

export type Verdict = 'safe' | 'violation' | 'unknown';

/**
 * Confidence tier of a finding:
 *   - `proven`     a sound proof under the verifier's model (hard bug)
 *   - `structural` a true structural fact flagged by policy (strong smell,
 *                  not a guaranteed runtime failure)
 */
export type Tier = 'proven' | 'structural';

export interface Finding {
  /** The property that was checked, e.g. `no-effect-infinite-loop`. */
  property: string;
  /** Only failing or undecidable findings are reported; `safe` produces none. */
  verdict: Exclude<Verdict, 'safe'>;
  /** Confidence tier — proven bug vs. structural smell. */
  tier: Tier;
  /** Name of the component/hook the finding belongs to, when known. */
  functionName: string | null;
  /** Human-readable summary of why the property failed or couldn't be decided. */
  reason: string;
  /** A counterexample trace (lines). Present for `violation`, may be empty otherwise. */
  witness: Array<string>;
  /** Source location of the primary offending node, when available. */
  loc: PrintedLoc | null;
}

export interface VerifierReport {
  /** Aggregate verdict across every function and property. */
  verdict: Verdict;
  /** Number of functions the verifier was able to analyze. */
  analyzedFunctions: number;
  /** All non-`safe` findings. */
  findings: Array<Finding>;
}

export function aggregateVerdict(findings: Array<Finding>): Verdict {
  if (findings.some(finding => finding.verdict === 'violation')) {
    return 'violation';
  }
  if (findings.some(finding => finding.verdict === 'unknown')) {
    return 'unknown';
  }
  return 'safe';
}
