// GENERATED — do not edit by hand. Run `pnpm gen:fixture-tests` to
// regenerate. Hand-written regression tests live in
// `rules-of-hooks.regressions.test.ts` and survive regeneration.

import { runOxcFixtures } from "../../../test-utils/run-fixtures.js";
import { failCases, passCases } from "./__fixtures__/rules-of-hooks.fixtures.js";
import { DIVERGENCES } from "./__fixtures__/oxc-divergences.js";
import { TRANSLATORS } from "./__fixtures__/oxc-settings-translators.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const divergence = DIVERGENCES["rules-of-hooks"];
runOxcFixtures(
  "react-builtins/rules-of-hooks",
  rulesOfHooks,
  { passCases, failCases },
  {
    translateOxcFixture: TRANSLATORS["rules-of-hooks"],
    canonicalPassDivergences: divergence?.canonicalPassSkips,
    knownPassDivergences: divergence?.passSkips,
    knownFailDivergences: divergence?.failSkips,
  },
);
