/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Native vite-plus/test port of facebook/react's `snap` fixture suite.
 * Each fixture under `fixtures/compiler/**` is compiled with the React
 * Compiler and compared against its stored `.expect.md` snapshot. The
 * runtime-evaluation (`### Eval output`) section is reused verbatim from
 * the stored snapshot rather than re-evaluated (see runner/harness.ts).
 */

import path from 'node:path';
import {describe, expect, test} from 'vite-plus/test';
import {FIXTURES_PATH, getFixtures, runFixture} from './runner/harness';

const fixtures = getFixtures();

describe('react-compiler fixtures', () => {
  for (const fixture of fixtures) {
    const name = path.relative(FIXTURES_PATH, fixture.inputPath);
    test(name, async () => {
      const result = await runFixture(fixture.basename, fixture.input, fixture.expected);
      expect(result.unexpectedError).toBe(null);
      expect(result.actual).toBe(result.expected);
    });
  }
});
