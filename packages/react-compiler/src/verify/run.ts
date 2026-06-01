/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * A `Check` is a single sound analysis over one analyzed `HIRFunction`. It
 * returns the non-`safe` findings it can prove (`violation`) or cannot decide
 * (`unknown`); returning nothing means "safe with respect to this property".
 */

import type {HIRFunction} from '../HIR';
import type {Finding} from './verdict';

export interface Check {
  property: string;
  run(fn: HIRFunction): Array<Finding>;
}

export function runChecks(
  fn: HIRFunction,
  checks: ReadonlyArray<Check>,
): Array<Finding> {
  const findings: Array<Finding> = [];
  for (const check of checks) {
    findings.push(...check.run(fn));
  }
  return findings;
}
