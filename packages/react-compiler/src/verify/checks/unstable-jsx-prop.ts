/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Family: Cross-component cascade. Flags a JSX prop passed to a child component
 * whose value is freshly allocated every render (object / array / function /
 * JSX). A fresh reference defeats the child's memoization, forcing it to
 * re-render even when nothing semantic changed.
 *
 * Tier: structural — a true fact about referential identity, flagged by policy.
 * (Note: the React Compiler stabilizes many of these; this reflects the program
 * "as written".) Only flags props on component tags, not DOM elements.
 */

import {type HIRFunction} from '../../HIR';
import {
  buildDefinitions,
  displayName,
  globalName,
  identifierName,
  isFreshAllocation,
  printLoc,
  underlyingValue,
} from '../hir-access';
import type {Check} from '../run';
import type {Finding} from '../verdict';

const PROPERTY = 'no-unstable-jsx-prop';

function run(fn: HIRFunction): Array<Finding> {
  const findings: Array<Finding> = [];
  const definitions = buildDefinitions(fn);
  const componentName = fn.id ?? null;

  for (const [, block] of fn.body.blocks) {
    for (const instr of block.instructions) {
      const value = instr.value;
      if (value.kind !== 'JsxExpression') {
        continue;
      }
      // Only component tags memoize; a fresh prop on a DOM element isn't a
      // cascade hazard.
      if (value.tag.kind !== 'Identifier') {
        continue;
      }
      const childName =
        globalName(value.tag.identifier.id, definitions) ??
        identifierName(value.tag.identifier);

      for (const attribute of value.props) {
        if (attribute.kind !== 'JsxAttribute') {
          continue;
        }
        const resolved = underlyingValue(attribute.place.identifier.id, definitions);
        if (!isFreshAllocation(resolved)) {
          continue;
        }
        const propValueName = displayName(attribute.place.identifier.id, definitions);
        findings.push({
          property: PROPERTY,
          verdict: 'violation',
          tier: 'structural',
          functionName: componentName,
          reason:
            'A JSX prop passed to a child component is allocated fresh every render, defeating the child’s memoization.',
          witness: [
            `<${childName} ${attribute.name}={${propValueName}} /> — \`${propValueName}\` is a fresh reference each render`,
            `  → \`${childName}\` re-renders every time the parent does, even when nothing changed`,
            '∴ wasted re-renders (unless React Compiler stabilizes it)',
          ],
          loc: printLoc(value.loc),
        });
      }
    }
  }
  return findings;
}

export const noUnstableJsxProp: Check = {property: PROPERTY, run};
